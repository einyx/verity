import { generateStandardId, generateStandardSecret } from '@logto/shared';
import {
  TenantRole,
  adminTenantId,
  defaultManagementApiAdminName,
  defaultTenantId,
  getTenantOrganizationId,
  getTenantRole,
  ossConsolePath,
} from '@logto/schemas';
import { addDays } from 'date-fns';
import { z } from 'zod/v3';

import { EnvSet } from '#src/env-set/index.js';
import RequestError from '#src/errors/RequestError/index.js';
import { readAcsMailConfig, sendMail } from '#src/libraries/acs-mail.js';
import {
  buildOnboardingEmailHtml,
  buildOnboardingEmailText,
  meshxLogoBase64,
} from '#src/libraries/onboarding-email.js';
import koaGuard from '#src/middleware/koa-guard.js';
import assertThat from '#src/utils/assert-that.js';

import { type ManagementApiRouter, type RouterInitArgs } from '../types.js';

// Sends the onboarding mail of a user somebody just created. The mail carries a sign-in link with a
// one-time token bound to the user's email address, so the person gets in on their own, and the
// roles the administrator picked for them.

// How long the onboarding link stays valid.
const onboardingTtlDays = 7;

export default function adminUserOnboardingRoutes<T extends ManagementApiRouter>(
  ...[router, { queries }]: RouterInitArgs<T>
) {
  router.post(
    '/users/:userId/onboarding-email',
    koaGuard({
      params: z.object({ userId: z.string() }),
      body: z.object({ roleName: z.enum(['admin', 'collaborator', 'viewer']).optional() }),
      status: [204, 404, 422, 501],
    }),
    async (ctx, next) => {
      const { userId } = ctx.guard.params;
      const { roleName } = ctx.guard.body;
      const user = await queries.users.findUserById(userId);
      const email = user.primaryEmail;

      assertThat(
        email,
        new RequestError({
          code: 'request.invalid_input',
          status: 422,
          details: 'The user has no email address to send the onboarding mail to.',
        })
      );

      // The token signs this one person in, and only them.
      const expiresAt = addDays(new Date(), onboardingTtlDays).getTime();
      const oneTimeToken = await queries.oneTimeTokens.insertOneTimeToken({
        id: generateStandardId(),
        email,
        token: generateStandardSecret(),
        expiresAt,
      });
      const link = new URL(`${ossConsolePath}/one-time-token`, EnvSet.values.adminUrlSet.endpoint);
      link.searchParams.set('one_time_token', oneTimeToken.token);
      link.searchParams.set('email', email);

      const inviter = await queries.users.findUserById(ctx.auth.id);
      const content = {
        firstName: user.name ?? 'there',
        inviterName: inviter.name ?? inviter.username ?? 'A meshX administrator',
        link: link.href,
        roleName: roleName ?? 'admin',
        expiresAt: new Date(expiresAt).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        }),
      };

      const config = readAcsMailConfig();

      assertThat(
        config,
        new RequestError({
          code: 'connector.not_found',
          status: 501,
          details: 'The platform mail service is not configured.',
        })
      );

      try {
        await sendMail(
          {
            to: email,
            subject: 'You have been invited to meshX console',
            text: buildOnboardingEmailText(content),
            html: buildOnboardingEmailHtml(content),
            replyTo: inviter.primaryEmail ?? undefined,
            attachments: [
              {
                contentType: 'image/png',
                contentInBase64: meshxLogoBase64,
                name: 'meshx-logo.png',
                contentId: 'meshx-logo',
              },
            ],
          },
          config
        );
      } catch (error: unknown) {
        // The mail is out, so the sign-in token must not stay usable.
        await queries.oneTimeTokens.deleteOneTimeTokenById(oneTimeToken.id);
        throw error;
      }

      // The roles are granted once the mail is out, so a failed send leaves nothing behind.
      // The Console reaches the tenant through the management API, which only the admin role can
      // enter. It is the Console access role, the same one the tenant invitation flow grants.
      const consoleRole = await queries.roles.findRoleByRoleName(defaultManagementApiAdminName);
      assertThat(
        consoleRole,
        new RequestError({
          code: 'entity.not_found',
          status: 422,
          details: `The \`${defaultManagementApiAdminName}\` role is missing.`,
        })
      );

      const currentRoles = await queries.usersRoles.findUsersRolesByUserId(userId);
      const rolesToAdd = [consoleRole.id].filter(
        (roleId) => !currentRoles.some(({ roleId: currentRoleId }) => currentRoleId === roleId)
      );

      if (rolesToAdd.length > 0) {
        await queries.usersRoles.insertUsersRoles(
          rolesToAdd.map((roleId) => ({ id: generateStandardId(), userId, roleId }))
        );
      }

      // The Console reads its permissions from the organization of the tenant: a person without a
      // role in it signs in and sees nothing, whatever their tenant roles say. The invited person
      // joins the same organizations the instance's own operators are in, with the role the
      // administrator picked.
      const organizationRoleId = getTenantRole(
        roleName === 'collaborator'
          ? TenantRole.Collaborator
          : roleName === 'viewer'
            ? TenantRole.Viewer
            : TenantRole.Admin
      ).id;

      for (const organizationId of [
        getTenantOrganizationId(adminTenantId),
        getTenantOrganizationId(defaultTenantId),
      ]) {
        await queries.organizations.relations.users.insert({ organizationId, userId });
        await queries.organizations.relations.usersRoles.insert({
          organizationId,
          organizationRoleId,
          userId,
        });
      }

      ctx.status = 204;
      return next();
    }
  );
}

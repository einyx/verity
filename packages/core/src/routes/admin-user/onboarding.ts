import { getTenantRole, ossConsolePath, TenantRole } from '@logto/schemas';
import { addDays } from 'date-fns';
import { z } from 'zod/v3';

import { EnvSet } from '#src/env-set/index.js';
import RequestError from '#src/errors/RequestError/index.js';
import { buildInvitationLink, sendInvitationMail } from '#src/libraries/tenant-invitation-mail.js';
import koaGuard from '#src/middleware/koa-guard.js';
import assertThat from '#src/utils/assert-that.js';

import {
  assertTenantInvitationFlowAllowed,
  tenantOrganizationId,
} from '../../routes-me/tenant-organization.js';
import { type ManagementApiRouter, type RouterInitArgs } from '../types.js';

// Sends the onboarding mail of a user somebody just created. The mail carries the same accept link
// as a tenant invitation: it signs the person in with a one-time token and gives them access to
// the tenant, so they can get in on their own.

/** How long the onboarding link stays valid. */
const onboardingTtlDays = 7;

export default function adminUserOnboardingRoutes<T extends ManagementApiRouter>(
  ...[router, { id, queries, libraries, withDefaultTenant }]: RouterInitArgs<T>
) {
  router.post(
    '/users/:userId/onboarding-email',
    koaGuard({
      params: z.object({ userId: z.string() }),
      body: z.object({ role: z.nativeEnum(TenantRole).optional() }),
      status: [204, 404, 422, 501],
    }),
    async (ctx, next) => {
      assertTenantInvitationFlowAllowed(id);

      const { userId } = ctx.guard.params;
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

      const invitee = email.toLowerCase();
      const expiresAt = addDays(new Date(), onboardingTtlDays).getTime();
      // The role the person gets in the tenant is chosen when the mail is sent.
      const role = ctx.guard.body.role ?? TenantRole.Admin;
      const context = await libraries.organizationInvitations.getOrganizationInvitationTemplateContext(
        tenantOrganizationId,
        ctx.auth.id
      );

      const invitation = await libraries.organizationInvitations.insert(
        {
          inviterId: ctx.auth.id,
          invitee,
          organizationId: tenantOrganizationId,
          expiresAt,
          organizationRoleIds: [getTenantRole(role).id],
        },
        false
      );

      const { link, oneTimeTokenId, hasAccount } = await buildInvitationLink({
        queries,
        invitationId: invitation.id,
        invitee,
        expiresAt,
        consoleEndpoint: EnvSet.values.adminUrlSet.endpoint,
        consolePath: ossConsolePath,
      });

      try {
        const sent = await sendInvitationMail({
          to: invitee,
          organizationName: context.organization?.name ?? 'meshX',
          inviterName: context.inviter?.name ?? context.inviter?.username,
          inviterEmail: context.inviter?.primaryEmail,
          firstName: user.name,
          link,
          expiresAt,
          hasAccount,
        });

        if (!sent) {
          // Without the platform's mail service the mail goes through the default tenant's
          // connector, the same way the tenant invitations do.
          await withDefaultTenant(async ({ libraries: tenantLibraries }) =>
            tenantLibraries.organizationInvitations.sendEmail(invitee, {
              ...context,
              link,
              locale: ctx.locale,
            })
          );
        }
      } catch (error: unknown) {
        // The mail is out, so the link must not stay usable.
        await queries.oneTimeTokens.deleteOneTimeTokenById(oneTimeTokenId);
        await queries.organizations.invitations.deleteById(invitation.id);
        throw error;
      }

      await queries.oneTimeTokens.revokeActiveOneTimeTokensByEmail(invitee, oneTimeTokenId);

      ctx.status = 204;
      return next();
    }
  );
}

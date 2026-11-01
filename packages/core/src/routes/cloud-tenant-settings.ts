import { adminTenantId, getTenantOrganizationId, TenantScope, TenantTag } from '@logto/schemas';
import { sql } from '@silverhand/slonik';
import { type Context } from 'koa';
import { type default as Router } from 'koa-router';
import { z } from 'zod/v3';

import { EnvSet } from '#src/env-set/index.js';
import RequestError from '#src/errors/RequestError/index.js';
import koaGuard from '#src/middleware/koa-guard.js';
import { readTenantScopes } from '#src/routes/cloud-console-host.js';
import { isAdminTenantOperator } from '#src/routes/cloud-tenant-access.js';
import { getTenantForUsage } from '#src/tenants/tenant-lookup.js';
import assertThat from '#src/utils/assert-that.js';
import { isReportablePlan } from '#src/utils/subscription/index.js';

export type TenantRow = {
  id: string;
  name: string;
  tag: string;
  regionName: string | undefined;
  createdAt: string | number | Date;
};

const settingsGuard = z.object({ isMfaRequired: z.boolean() }).strict();
// The installed profile contract is name-only; older Console saves also echo the current tag.
const profileGuard = z
  .object({
    name: z.string().min(1).max(128).optional(),
    tag: z.nativeEnum(TenantTag).optional(),
  })
  .strict();
const notFound = () => new RequestError({ code: 'entity.not_found', status: 404 });
const forbidden = () => new RequestError({ code: 'auth.forbidden', status: 403 });
const invalidProfile = () =>
  new RequestError({ code: 'guard.invalid_input', type: 'body', status: 400 });

const readSettings = async (tenantId: string) => {
  const pool = await EnvSet.sharedPool;
  const settings = await pool.maybeOne<{ isMfaRequired: boolean }>(sql`
    select is_mfa_required as "isMfaRequired" from organizations
    where tenant_id = ${adminTenantId} and id = ${getTenantOrganizationId(tenantId)}
  `);
  assertThat(settings, notFound());
  return settings;
};

/** These routes own their responses: never continue into the billing catch-all on success. */
export const mountCloudTenantSettingsRoutes = (
  router: Router,
  authenticate: (ctx: Context) => Promise<string>,
  toTenantResponse: (row: TenantRow) => unknown
) => {
  const authorize = async (ctx: Context, scope: TenantScope) => {
    // Authenticate verifies admin issuer/JWKS, Cloud audience/scope, user token and global access policy.
    const userId = await authenticate(ctx);
    const pool = await EnvSet.sharedPool;
    assertThat(
      await pool.maybeOne(sql`
      select id from users where tenant_id = ${adminTenantId} and id = ${userId}
        and is_suspended = false
    `),
      forbidden()
    );
    const tenantId = String(ctx.params.tenantId ?? '');
    // Preserve intentional concealment of the admin target from nonoperators.
    if (tenantId === adminTenantId) {
      assertThat(await isAdminTenantOperator(pool, userId), notFound());
    }
    const row = await pool.maybeOne<TenantRow>(sql`
      select id, name, tag, region_name as "regionName", created_at as "createdAt"
      from tenants where id = ${tenantId}
    `);
    assertThat(row, notFound());
    const scopes = await readTenantScopes(pool, tenantId, userId);
    assertThat(
      scopes.some(({ name }) => name === scope),
      forbidden()
    );
    return row;
  };
  router.get(
    '/api/tenants/:tenantId',
    koaGuard({ status: [200, 304, 401, 403, 404] }),
    async (ctx) => {
      ctx.body = toTenantResponse(await authorize(ctx, TenantScope.ReadData));
    }
  );
  router.patch(
    '/api/tenants/:tenantId',
    koaGuard({ body: profileGuard, status: [200, 400, 401, 403, 404] }),
    async (ctx) => {
      const row = await authorize(ctx, TenantScope.ManageTenant);
      const { name, tag } = ctx.guard.body;
      assertThat(tag === undefined || tag === row.tag, invalidProfile());
      const pool = await EnvSet.sharedPool;
      // A conditional update is atomic with the tag comparison, including a concurrent billing conversion.
      // Never write tag (or any billing metadata), even if the Console echoed it unchanged.
      const updated = await pool.maybeOne<TenantRow>(sql`
      update tenants set name = ${name ?? sql.identifier(['name'])}
      where id = ${row.id} and tag = ${row.tag}
      returning id, name, tag, region_name as "regionName", created_at as "createdAt"
    `);
      assertThat(updated, invalidProfile());
      ctx.body = toTenantResponse(updated);
    }
  );
  router.get(
    '/api/tenants/:tenantId/settings',
    koaGuard({ status: [200, 401, 403, 404] }),
    async (ctx) => {
      const row = await authorize(ctx, TenantScope.ManageTenant);
      ctx.body = await readSettings(row.id);
    }
  );
  router.patch(
    '/api/tenants/:tenantId/settings',
    koaGuard({ body: settingsGuard, status: [200, 400, 401, 403, 404, 503] }),
    async (ctx) => {
      const row = await authorize(ctx, TenantScope.ManageTenant);
      await readSettings(row.id);
      const { isMfaRequired } = ctx.guard.body;
      if (isMfaRequired && row.tag !== TenantTag.Development) {
        // Only the target's authoritative service is eligible; the tenant response is not entitlement data.
        const subscription = await (async () => {
          try {
            const tenant = await getTenantForUsage(row.id);
            return await tenant.subscription.getSubscriptionData?.();
          } catch {
            throw new RequestError(
              { code: 'auth.forbidden', status: 503 },
              { reason: 'entitlement_unavailable' }
            );
          }
        })();
        assertThat(
          subscription,
          new RequestError(
            { code: 'auth.forbidden', status: 503 },
            { reason: 'entitlement_unavailable' }
          )
        );
        assertThat(
          isReportablePlan(subscription.planId, subscription.isEnterprisePlan),
          forbidden()
        );
      }
      const pool = await EnvSet.sharedPool;
      const settings = await pool.maybeOne<{ isMfaRequired: boolean }>(sql`
      update organizations set is_mfa_required = ${isMfaRequired}
      where tenant_id = ${adminTenantId} and id = ${getTenantOrganizationId(row.id)}
        and exists (select 1 from tenants where id = ${row.id} and tag = ${row.tag})
      returning is_mfa_required as "isMfaRequired"
    `);
      assertThat(settings, notFound());
      ctx.body = settings;
    }
  );
};

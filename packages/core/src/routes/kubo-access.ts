import { adminTenantId } from '@logto/schemas';
import { sql } from '@silverhand/slonik';

import { EnvSet } from '#src/env-set/index.js';
import RequestError from '#src/errors/RequestError/index.js';
import type TenantContext from '#src/tenants/TenantContext.js';
import assertThat from '#src/utils/assert-that.js';

import { isAdminTenantOperator } from './cloud-tenant-access.js';
import type { ManagementApiRouterContext } from './types.js';

export type KuboAccess = {
  tenantId: string;
  actorId: string;
  operator: boolean;
  canViewAll: boolean;
};

/**
 * Local development only: `KUBO_DEV_ALL_SCOPE=1` (set by docker-compose.dev.yml) lets a verified
 * user of the admin tenant view every workspace without a global operator role. Never set in
 * production deployments.
 */
const devAllScopeEnabled = (tenantId: string) =>
  process.env.KUBO_DEV_ALL_SCOPE === '1' && tenantId === adminTenantId;

const isActiveAdminOperator = async (actorId: string) => {
  const pool = await EnvSet.sharedPool;
  const user = await pool.maybeOne<{ isSuspended: boolean }>(sql`
    select is_suspended as "isSuspended" from users
    where tenant_id = ${adminTenantId} and id = ${actorId}
  `);
  if (user?.isSuspended !== false) {
    return false;
  }
  return isAdminTenantOperator(pool, actorId);
};

export const resolveKuboAccess = async (
  tenant: TenantContext,
  ctx: ManagementApiRouterContext
): Promise<KuboAccess> => {
  assertThat(ctx.auth.id, new RequestError({ code: 'auth.unauthorized', status: 401 }));
  assertThat(
    ctx.query.scope === undefined || ctx.query.scope === 'tenant' || ctx.query.scope === 'all',
    new RequestError({ code: 'auth.forbidden', status: 403 })
  );
  // The normal view does not consult global roles. Capability discovery and explicit all-scope do.
  const discover = ctx.path === '/kubo/access' || ctx.path.endsWith('/kubo/access');
  const canCheck = ctx.auth.type === 'user' && ctx.auth.verifiedConsoleIdentity;
  const canViewAll = Boolean(
    canCheck &&
    (ctx.query.scope === 'all' || discover) &&
    (devAllScopeEnabled(tenant.id) || (await isActiveAdminOperator(ctx.auth.id)))
  );
  assertThat(
    ctx.query.scope !== 'all' || canViewAll,
    new RequestError({ code: 'auth.forbidden', status: 403 })
  );
  return {
    tenantId: tenant.id,
    actorId: ctx.auth.id,
    operator: ctx.query.scope === 'all',
    canViewAll,
  };
};

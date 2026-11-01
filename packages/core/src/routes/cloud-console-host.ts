import {
  adminTenantId,
  ConnectorType,
  getTenantOrganizationId,
  OrganizationInvitationStatus,
  TenantScope,
} from '@logto/schemas';
import { sql, type CommonQueryMethods } from '@silverhand/slonik';

import { type CloudConsoleHost } from '#src/cloud-plugin/loader.js';
import { EnvSet } from '#src/env-set/index.js';
import { isAdminTenantOperator } from '#src/routes/cloud-tenant-access.js';
import { getTenantForUsage } from '#src/tenants/tenant-lookup.js';

const countKeys = [
  'applicationsLimit',
  'thirdPartyApplicationsLimit',
  'machineToMachineLimit',
  'userRolesLimit',
  'machineToMachineRolesLimit',
  'hooksLimit',
  'resourcesLimit',
  'enterpriseSsoLimit',
  'organizationsLimit',
  'samlApplicationsLimit',
  'customDomainsLimit',
] as const;

export const readTenantScopes = async (
  pool: CommonQueryMethods,
  tenantId: string,
  userId: string
) => {
  if (await isAdminTenantOperator(pool, userId)) {
    const tenant = await pool.maybeOne<{ id: string }>(
      sql`select id from tenants where id = ${tenantId}`
    );
    return tenant ? Object.values(TenantScope).map((name) => ({ name })) : [];
  }
  return pool.any<{ name: string }>(sql`
    select distinct s.name
    from organization_user_relations m
    join tenants t on t.id = ${tenantId}
    join organization_role_user_relations ur
      on ur.tenant_id = m.tenant_id and ur.organization_id = m.organization_id and ur.user_id = m.user_id
    join organization_role_scope_relations rs
      on rs.tenant_id = ur.tenant_id and rs.organization_role_id = ur.organization_role_id
    join organization_scopes s
      on s.tenant_id = rs.tenant_id and s.id = rs.organization_scope_id
    where m.tenant_id = ${adminTenantId}
      and m.organization_id = ${getTenantOrganizationId(tenantId)}
      and m.user_id = ${userId}
    order by s.name
  `);
};

/** Read-only host adapters. The cloud package authenticates before calling any adapter. */
export const createCloudConsoleHost = (): CloudConsoleHost => ({
  hasUser: async (userId) => {
    const pool = await EnvSet.sharedPool;
    return Boolean(
      await pool.maybeOne(sql`
      select id from users
      where tenant_id = ${adminTenantId} and id = ${userId} and is_suspended = false
    `)
    );
  },
  memberScopes: async (actorId, tenantId, memberId) => {
    const pool = await EnvSet.sharedPool;
    const callerScopes = await readTenantScopes(pool, tenantId, actorId);
    if (
      callerScopes.length === 0 ||
      (actorId !== memberId && !callerScopes.some(({ name }) => name === TenantScope.ReadMember))
    ) {
      return;
    }
    const scopes =
      actorId === memberId ? callerScopes : await readTenantScopes(pool, tenantId, memberId);
    return scopes.length > 0 ? [...scopes] : undefined;
  },
  invitations: async (userId) => {
    const pool = await EnvSet.sharedPool;
    const invitations = await pool.any<{
      id: string;
      organizationId: string;
      tenantName: string;
      tenantTag: string;
    }>(sql`
      select i.id, i.organization_id as "organizationId", t.name as "tenantName", t.tag as "tenantTag"
      from organization_invitations i
      join users u on u.tenant_id = i.tenant_id and lower(u.primary_email) = lower(i.invitee)
      join tenants t on i.organization_id = 't-' || t.id
      where i.tenant_id = ${adminTenantId} and u.id = ${userId}
        and i.status = ${OrganizationInvitationStatus.Pending} and i.expires_at > now()
      order by i.created_at
    `);
    return [...invitations];
  },
  usage: async (tenantId) => {
    const tenant = await getTenantForUsage(tenantId);
    const entries = await Promise.all(
      countKeys.map(
        async (key) =>
          [
            key,
            // eslint-disable-next-line unicorn/no-useless-undefined -- The conditional query signature requires an explicit entity argument for tenant-wide counters.
            await tenant.queries.tenantUsage.getSelfComputedUsageByKey(tenantId, key, undefined),
          ] as const
      )
    );
    const pool = await EnvSet.sharedPool;
    const [connectors, members, resourceCounts, roleCounts] = await Promise.all([
      tenant.connectors.getLogtoConnectors(),
      pool.one<{ count: number }>(sql`
        select count(*)::integer as count from organization_user_relations
        where tenant_id = ${adminTenantId} and organization_id = ${getTenantOrganizationId(tenantId)}
      `),
      tenant.queries.pool.any<{ id: string; count: number }>(sql`
        select resource_id as id, count(*)::integer as count from scopes
        where tenant_id = ${tenantId} group by resource_id
      `),
      tenant.queries.pool.any<{ id: string; count: number }>(sql`
        select role_id as id, count(*)::integer as count from roles_scopes
        where tenant_id = ${tenantId} group by role_id
      `),
    ]);
    return {
      usage: {
        ...Object.fromEntries(entries),
        socialConnectorsLimit: connectors.filter(({ type }) => type === ConnectorType.Social)
          .length,
        tenantMembersLimit: members.count,
      },
      resources: Object.fromEntries(resourceCounts.map(({ id, count }) => [id, count])),
      roles: Object.fromEntries(roleCounts.map(({ id, count }) => [id, count])),
    };
  },
});

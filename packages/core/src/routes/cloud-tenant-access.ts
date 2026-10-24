import { adminTenantId } from '@logto/schemas';
import { sql, type CommonQueryMethods } from '@silverhand/slonik';
import { z } from 'zod/v3';

// Who may manage customer tenants on this instance: an operator of the admin tenant, or a user whose
// primary email is on the allow-list. The allow-list is set from the admin tenant's console and stored in
// the admin tenant's own config, so the console is the only place it can change.

export const defaultTenantAccessDomains = ['meshx.io'] as const;

const configKey = 'cloud_tenant_access';

const domainPattern = /^[\da-z-]+(\.[\da-z-]+)+$/;

export const tenantAccessPolicyBody = z.object({
  domains: z.array(z.string().trim().toLowerCase().regex(domainPattern).max(253)).min(1).max(20),
});

type Pool = CommonQueryMethods;

/** The domains allowed to manage tenants: the saved list, or the default when none is saved. */
export const readTenantAccessDomains = async (pool: Pool): Promise<readonly string[]> => {
  const row = await pool.maybeOne<{ value: { domains?: unknown } }>(sql`
    select value
    from logto_configs
    where tenant_id = ${adminTenantId} and key = ${configKey}
  `);
  const domains = row?.value.domains;

  return Array.isArray(domains) && domains.length > 0
    ? domains.filter((domain): domain is string => typeof domain === 'string')
    : defaultTenantAccessDomains;
};

/** Saves the allow-list for the admin tenant. Only the caller's check decides who may call this. */
export const writeTenantAccessDomains = async (pool: Pool, domains: readonly string[]) => {
  await pool.query(sql`
    insert into logto_configs (tenant_id, key, value)
    values (${adminTenantId}, ${configKey}, ${sql.jsonb({ domains: [...domains] })})
    on conflict (tenant_id, key) do update set value = excluded.value
  `);
};

/** True when the user is an admin of the admin tenant, which is the instance's own console. */
export const isAdminTenantOperator = async (pool: Pool, userId: string): Promise<boolean> => {
  const row = await pool.maybeOne<{ userId: string }>(sql`
    select ur.user_id as "userId"
    from users_roles ur
    join roles r on r.id = ur.role_id
    where ur.tenant_id = ${adminTenantId} and ur.user_id = ${userId} and r.name = 'admin'
    limit 1
  `);

  return Boolean(row);
};

/** True when the user may manage customer tenants: an admin-tenant operator or an allow-listed email domain. */
export const canManageTenants = async (pool: Pool, userId: string): Promise<boolean> => {
  if (await isAdminTenantOperator(pool, userId)) {
    return true;
  }

  const user = await pool.maybeOne<{ primaryEmail: string | undefined }>(sql`
    select primary_email as "primaryEmail"
    from users
    where tenant_id = ${adminTenantId} and id = ${userId}
  `);
  const domain = user?.primaryEmail?.split('@').at(-1)?.toLowerCase();

  if (!domain) {
    return false;
  }

  const allowed = await readTenantAccessDomains(pool);

  return allowed.includes(domain);
};

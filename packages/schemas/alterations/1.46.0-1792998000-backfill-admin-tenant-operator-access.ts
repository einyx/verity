import { generateStandardId } from '@logto/shared/universal';
import { sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

// The earliest admin-tenant user may be created after this instance's migrations have run.
// Ensure every admin-tenant operator can obtain a fully-scoped token for the admin organization.
const adminTenantId = 'admin';
const adminOrganizationId = `t-${adminTenantId}`;
const adminOrganizationRoleId = 'admin';

const alteration: AlterationScript = {
  up: async (pool) => {
    // The admin console calls the admin tenant's Management API directly. Give its operator role
    // the `all` scope for that resource; the organization `all` scope is a separate permission set.
    await pool.query(sql`
      insert into roles_scopes (tenant_id, id, role_id, scope_id)
      select ${adminTenantId}, ${generateStandardId()}, roles.id, scopes.id
      from roles
      join resources on resources.tenant_id = roles.tenant_id
        and resources.name = 'Logto Management API for tenant admin'
      join scopes on scopes.tenant_id = resources.tenant_id
        and scopes.resource_id = resources.id and scopes.name = 'all'
      where roles.tenant_id = ${adminTenantId} and roles.name = 'admin'
      on conflict do nothing;
    `);

    await pool.query(sql`
      insert into organization_scopes (tenant_id, id, name, description)
      values (
        ${adminTenantId}, 'admin-org-all', 'all', 'Full access to the admin tenant.'
      )
      on conflict (tenant_id, name) do nothing;
    `);
    await pool.query(sql`
      insert into organization_role_scope_relations (
        tenant_id, organization_role_id, organization_scope_id
      )
      select ${adminTenantId}, ${adminOrganizationRoleId}, scopes.id
      from organization_scopes as scopes
      where scopes.tenant_id = ${adminTenantId} and scopes.name = 'all'
        and not exists (
          select 1 from organization_role_scope_relations as relations
          where relations.tenant_id = ${adminTenantId}
            and relations.organization_role_id = ${adminOrganizationRoleId}
            and relations.organization_scope_id = scopes.id
        );
    `);
    await pool.query(sql`
      insert into organization_user_relations (tenant_id, organization_id, user_id)
      select distinct ur.tenant_id, ${adminOrganizationId}, ur.user_id
      from users_roles ur
      join roles r on r.id = ur.role_id and r.tenant_id = ur.tenant_id
      where ur.tenant_id = ${adminTenantId} and r.name = ${adminOrganizationRoleId}
      on conflict do nothing;
    `);
    await pool.query(sql`
      insert into organization_role_user_relations (
        tenant_id, organization_id, organization_role_id, user_id
      )
      select distinct ur.tenant_id, ${adminOrganizationId}, ${adminOrganizationRoleId}, ur.user_id
      from users_roles ur
      join roles r on r.id = ur.role_id and r.tenant_id = ur.tenant_id
      where ur.tenant_id = ${adminTenantId} and r.name = ${adminOrganizationRoleId}
      on conflict do nothing;
    `);
  },
  down: async () => {
    // Keep operator memberships and roles to avoid locking operators out of the Admin Console.
  },
};

export default alteration;

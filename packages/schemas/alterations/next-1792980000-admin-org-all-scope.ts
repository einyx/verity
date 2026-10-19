import { generateStandardId } from '@logto/shared/universal';
import { sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

// The admin Management API requires the `all` scope on organization tokens for the admin tenant. The
// admin organization role gets `all` here, so admin-tenant operators who hold that role keep access
// after the organization-token change. Other organization roles are untouched.
const adminTenantId = 'admin';
const adminOrganizationRoleId = 'admin';
const allScopeName = 'all';
const allScopeDescription = 'Full access to the admin tenant.';

const alteration: AlterationScript = {
  up: async (pool) => {
    await pool.query(sql`
      insert into organization_scopes (tenant_id, id, name, description)
      select ${adminTenantId}, ${generateStandardId()}, ${allScopeName}, ${allScopeDescription}
      where not exists (
        select 1 from organization_scopes
        where tenant_id = ${adminTenantId} and name = ${allScopeName}
      );
    `);
    await pool.query(sql`
      insert into organization_role_scope_relations (tenant_id, organization_role_id, organization_scope_id)
      select ${adminTenantId}, ${adminOrganizationRoleId}, scopes.id
      from organization_scopes as scopes
      where scopes.tenant_id = ${adminTenantId} and scopes.name = ${allScopeName}
        and not exists (
          select 1 from organization_role_scope_relations as relations
          where relations.tenant_id = ${adminTenantId}
            and relations.organization_role_id = ${adminOrganizationRoleId}
            and relations.organization_scope_id = scopes.id
        );
    `);
  },
  down: async () => {
    // The `all` scope is kept on rollback: removing it would lock operators out of the admin console.
  },
};

export default alteration;

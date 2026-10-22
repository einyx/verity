import { sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

// The admin console reads its config with a token issued for the admin tenant's organization
// (`urn:logto:organization:t-admin`). A token only carries scopes when the user belongs to that
// organization with an organization role, so every operator who holds the admin role in the admin
// tenant is added to the admin organization with the `admin` organization role. Other users are untouched.
const adminTenantId = 'admin';
const adminOrganizationId = `t-${adminTenantId}`;
const adminRoleName = 'admin';
const adminOrganizationRoleId = 'admin';

const alteration: AlterationScript = {
  up: async (pool) => {
    await pool.query(sql`
      insert into organization_user_relations (tenant_id, organization_id, user_id)
      select distinct ur.tenant_id, ${adminOrganizationId}, ur.user_id
      from users_roles ur
      join roles r on r.id = ur.role_id and r.tenant_id = ur.tenant_id
      where ur.tenant_id = ${adminTenantId} and r.name = ${adminRoleName}
      on conflict do nothing;
    `);
    await pool.query(sql`
      insert into organization_role_user_relations (tenant_id, organization_id, organization_role_id, user_id)
      select distinct ur.tenant_id, ${adminOrganizationId}, ${adminOrganizationRoleId}, ur.user_id
      from users_roles ur
      join roles r on r.id = ur.role_id and r.tenant_id = ur.tenant_id
      where ur.tenant_id = ${adminTenantId} and r.name = ${adminRoleName}
      on conflict do nothing;
    `);
  },
  down: async () => {
    // Memberships are kept on rollback: removing them would lock operators out of the admin console.
  },
};

export default alteration;

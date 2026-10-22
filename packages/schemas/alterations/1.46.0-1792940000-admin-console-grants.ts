import { generateStandardId } from '@logto/shared/universal';
import { sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

// Lets the admin console sign in to the admin tenant and use its APIs. The admin tenant's Management API
// is addressed by its meshx.foundation origin, the operator gets the `all` scope on that API through the
// `admin` role, and the console app is granted consent for the Cloud API, the Me API, the admin
// Management API and the admin tenant's organization. Instances without the Cloud API have nothing to attach.
const adminTenantId = 'admin';
const adminConsoleAppId = 'admin-console';
const adminRoleName = 'admin';
const adminOrganizationId = `t-${adminTenantId}`;
const adminManagementApiName = 'Logto Management API for tenant admin';
const adminManagementApiIndicator = 'https://admin.meshx.foundation/api';
const previousAdminManagementApiIndicator = 'https://admin.logto.app/api';
const cloudApiIndicators = [
  'https://console.meshx.foundation/api',
  'https://console.meshx.foundation/me',
];

const alteration: AlterationScript = {
  up: async (pool) => {
    await pool.query(sql`
      update resources set indicator = ${adminManagementApiIndicator}
      where tenant_id = ${adminTenantId} and name = ${adminManagementApiName}
        and indicator = ${previousAdminManagementApiIndicator}
    `);

    const operator = await pool.maybeOne<{ id: string }>(sql`
      select id from users where tenant_id = ${adminTenantId} order by created_at limit 1
    `);
    if (!operator) {
      return;
    }

    const organization = await pool.maybeOne<{ id: string }>(sql`
      select id from organizations where tenant_id = ${adminTenantId} and id = ${adminOrganizationId}
    `);
    if (!organization) {
      return;
    }

    await pool.query(sql`
      insert into organization_user_relations (tenant_id, organization_id, user_id)
      values (${adminTenantId}, ${adminOrganizationId}, ${operator.id})
      on conflict do nothing
    `);

    const role = await pool.maybeOne<{ id: string }>(sql`
      select id from roles where tenant_id = ${adminTenantId} and name = ${adminRoleName}
    `);
    const allScope = await pool.maybeOne<{ id: string }>(sql`
      select s.id from scopes s
      join resources res on res.id = s.resource_id
      where s.tenant_id = ${adminTenantId} and s.name = 'all' and res.indicator = ${adminManagementApiIndicator}
    `);
    if (role && allScope) {
      await pool.query(sql`
        insert into roles_scopes (id, tenant_id, role_id, scope_id)
        select ${generateStandardId()}, ${adminTenantId}, ${role.id}, ${allScope.id}
        where not exists (
          select 1 from roles_scopes where role_id = ${role.id} and scope_id = ${allScope.id}
        )
      `);
    }

    await pool.query(sql`
      insert into application_user_consent_resource_scopes (tenant_id, application_id, scope_id)
      select ${adminTenantId}, ${adminConsoleAppId}, s.id
      from scopes s
      join resources res on res.id = s.resource_id
      where res.tenant_id = ${adminTenantId}
        and (res.indicator = any(${sql.array([...cloudApiIndicators, adminManagementApiIndicator], 'text')}))
      on conflict do nothing
    `);

    await pool.query(sql`
      insert into application_user_consent_organizations (tenant_id, application_id, organization_id, user_id)
      values (${adminTenantId}, ${adminConsoleAppId}, ${adminOrganizationId}, ${operator.id})
      on conflict do nothing
    `);
  },
  down: async () => {
    // The consent records and memberships may predate this alteration, so they are left in place.
  },
};

export default alteration;

import { generateStandardId } from '@logto/shared/universal';
import { sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

// Adds the `admin` role of the admin tenant, which carries the `manage:landing:page` Cloud scope, and
// gives it to the earliest admin-tenant user: the instance's operator. Sign-up is unchanged, so no
// other user gets the role. Instances without the Cloud API (self-hosted) have nothing to attach to.
const adminTenantId = 'admin';
const cloudApiResourceName = 'Logto Cloud API';
const adminRoleName = 'admin';
const scopeName = 'manage:landing:page';

const alteration: AlterationScript = {
  up: async (pool) => {
    const resource = await pool.maybeOne<{ id: string }>(sql`
      select id from resources
      where tenant_id = ${adminTenantId} and name = ${cloudApiResourceName}
    `);
    if (!resource) {
      return;
    }

    const scope = await pool.maybeOne<{ id: string }>(sql`
      select id from scopes
      where tenant_id = ${adminTenantId} and resource_id = ${resource.id} and name = ${scopeName}
    `);
    if (!scope) {
      return;
    }

    await pool.query(sql`
      insert into roles (id, tenant_id, name, description, type, is_default)
      values (
        ${generateStandardId()}, ${adminTenantId}, ${adminRoleName},
        ${'The admin of the admin tenant, who manages Logto Cloud pages such as the landing page.'},
        'User', false
      )
      on conflict (tenant_id, name) do nothing
    `);
    const role = await pool.maybeOne<{ id: string }>(sql`
      select id from roles where tenant_id = ${adminTenantId} and name = ${adminRoleName}
    `);
    if (!role) {
      return;
    }

    await pool.query(sql`
      insert into roles_scopes (id, tenant_id, role_id, scope_id)
      select ${generateStandardId()}, ${adminTenantId}, ${role.id}, ${scope.id}
      where not exists (
        select 1 from roles_scopes where role_id = ${role.id} and scope_id = ${scope.id}
      )
    `);

    const operator = await pool.maybeOne<{ id: string }>(sql`
      select id from users
      where tenant_id = ${adminTenantId}
      order by created_at
      limit 1
    `);
    if (!operator) {
      return;
    }

    await pool.query(sql`
      insert into users_roles (id, tenant_id, user_id, role_id)
      select ${generateStandardId()}, ${adminTenantId}, ${operator.id}, ${role.id}
      where not exists (
        select 1 from users_roles where user_id = ${operator.id} and role_id = ${role.id}
      )
    `);
  },
  down: async (pool) => {
    // Removing the role also removes its scope and user links, through the cascades.
    await pool.query(sql`
      delete from roles where tenant_id = ${adminTenantId} and name = ${adminRoleName}
    `);
  },
};

export default alteration;

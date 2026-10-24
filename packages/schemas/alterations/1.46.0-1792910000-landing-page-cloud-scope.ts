import { generateStandardId } from '@logto/shared/universal';
import { sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

// Adds the `manage:landing:page` Cloud API scope to instances that already have the Cloud API
// resource. The scope is not granted to any role here: only an operator can grant it, so customers'
// `User` role never receives marketing-page editing.
const adminTenantId = 'admin';
const cloudApiResourceName = 'Logto Cloud API';
const scopeName = 'manage:landing:page';
const scopeDescription = 'Allow editing and publishing the landing page of the marketing site.';

const alteration: AlterationScript = {
  up: async (pool) => {
    const resource = await pool.maybeOne<{ id: string }>(sql`
      select id from resources
      where tenant_id = ${adminTenantId} and name = ${cloudApiResourceName}
    `);

    // Instances without the Cloud API (self-hosted) have nothing to attach the scope to.
    if (!resource) {
      return;
    }

    await pool.query(sql`
      insert into scopes (id, tenant_id, resource_id, name, description)
      values (${generateStandardId()}, ${adminTenantId}, ${resource.id}, ${scopeName}, ${scopeDescription})
      on conflict do nothing;
    `);
  },
  down: async (pool) => {
    await pool.query(sql`
      delete from scopes
      where tenant_id = ${adminTenantId} and name = ${scopeName};
    `);
  },
};

export default alteration;

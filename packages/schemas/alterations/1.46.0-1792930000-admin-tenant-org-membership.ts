import { sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

// Adds the earliest admin-tenant user, the instance's operator, to the admin tenant's own organization.
// The Cloud tenant API checks membership in that organization before it issues a token for it, so
// without this row the operator is refused the admin tenant. Instances without the Cloud API have no
// organization to join, and the insert changes nothing there.
const adminTenantId = 'admin';

const alteration: AlterationScript = {
  up: async (pool) => {
    // Same format as `getTenantOrganizationId` in `src/types/tenant-organization.ts`.
    const organizationId = `t-${adminTenantId}`;

    const organization = await pool.maybeOne<{ id: string }>(sql`
      select id from organizations where tenant_id = ${adminTenantId} and id = ${organizationId}
    `);
    if (!organization) {
      return;
    }

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
      insert into organization_user_relations (tenant_id, organization_id, user_id)
      values (${adminTenantId}, ${organization.id}, ${operator.id})
      on conflict do nothing
    `);
  },
  down: async () => {
    // The membership may predate this alteration, so it is left in place. Removing it could cut the
    // operator off from the admin tenant.
  },
};

export default alteration;

import { sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

// The admin tenant is the instance's own Console. It is not a development tenant, so it is
// tagged as a production one: the Console shows the environment of the tenant it is in, and
// the admin tenant was the only one still tagged as a development tenant.
const adminTenantId = 'admin';

const alteration: AlterationScript = {
  up: async (pool) => {
    await pool.query(sql`
      update tenants
      set tag = 'production'
      where id = ${adminTenantId} and tag = 'development'
    `);
  },
  down: async (pool) => {
    await pool.query(sql`
      update tenants
      set tag = 'development'
      where id = ${adminTenantId}
    `);
  },
};

export default alteration;

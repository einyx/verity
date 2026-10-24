import { sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

const alteration: AlterationScript = {
  up: async (pool) => {
    await pool.query(sql`
      update tenants
      set name = 'Admin'
      where id = 'admin' and name = 'My Project'
    `);
  },
  down: async () => {
    // Keep the tenant name on rollback; it may have been changed intentionally after migration.
  },
};

export default alteration;

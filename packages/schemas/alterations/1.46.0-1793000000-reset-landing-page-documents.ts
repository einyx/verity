import { sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

// The landing-page editor is moving to a new sections-only document contract. Past page drafts,
// published content, and rollback history were explicitly approved for reset rather than migration.
const adminTenantId = 'admin';

const alteration: AlterationScript = {
  up: async (pool) => {
    await pool.query(sql`
      delete from landing_page_versions
      where tenant_id = ${adminTenantId};
    `);

    await pool.query(sql`
      delete from landing_pages
      where tenant_id = ${adminTenantId};
    `);
  },
  down: async () => {
    // The prior page content and version history are intentionally not recoverable.
  },
};

export default alteration;

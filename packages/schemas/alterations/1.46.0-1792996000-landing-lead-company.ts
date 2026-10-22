import { sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

// Company research for a landing lead: a short summary built from the company's own public site, with the
// pages it was read from. Stored on the admin-tenant lead row, so it follows the lead's existing access.
const leadTable = 'landing_leads';

const alteration: AlterationScript = {
  up: async (pool) => {
    const leadTableId = sql.identifier([leadTable]);

    await pool.query(sql`
      alter table ${leadTableId} add column if not exists company_profile jsonb;
    `);
  },
  down: async (pool) => {
    const leadTableId = sql.identifier([leadTable]);

    await pool.query(sql`
      alter table ${leadTableId} drop column if exists company_profile;
    `);
  },
};

export default alteration;

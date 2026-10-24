import { sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

const leadTable = 'landing_leads';

const alteration: AlterationScript = {
  up: async (pool) => {
    await pool.query(sql`
      alter table ${sql.identifier([leadTable])}
        add column if not exists notes text not null default '',
        add column if not exists tags text[] not null default '{}';
    `);
  },
  down: async (pool) => {
    await pool.query(sql`
      alter table ${sql.identifier([leadTable])}
        drop column if exists notes,
        drop column if exists tags;
    `);
  },
};

export default alteration;

import { sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

// Moves the built-in Management API resource indicators from `*.logto.app` to
// `*.meshx.foundation`, one per tenant: `https://<tenant>.logto.app/api` becomes
// `https://<tenant>.meshx.foundation/api`. Only management resources are touched
// (the `/api` indicators under the Logto domain); other resources keep their values.
const logtoIndicator = String.raw`^https://([^.]+)\.logto\.app/api$`;
const meshxIndicator = String.raw`https://\1.meshx.foundation/api`;

const alteration: AlterationScript = {
  up: async (pool) => {
    await pool.query(sql`
      update resources
      set indicator = regexp_replace(indicator, ${logtoIndicator}, ${meshxIndicator})
      where indicator ~ ${logtoIndicator};
    `);
  },
  down: async (pool) => {
    await pool.query(sql`
      update resources
      set indicator = regexp_replace(indicator, '^https://([^.]+)\.meshx\.foundation/api$', 'https://\1.logto.app/api')
      where indicator ~ '^https://[^.]+\.meshx\.foundation/api$';
    `);
  },
};

export default alteration;

import { sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

// Moves the built-in Management API resource indicators from `*.logto.app` to
// the deployment's own domain, one per tenant: `https://<tenant>.logto.app/api`
// becomes `https://prysm.sh/api`. Only management resources are touched (the
// `/api` indicators under the Logto domain); other resources keep their values.
//
// The indicator no longer carries the tenant in its host: a single deployment
// serves every tenant, so the tenant is identified by the token audience
// instead of by a per-tenant subdomain.
const logtoIndicator = String.raw`^https://([^.]+)\.logto\.app/api$`;
const deploymentIndicator = 'https://prysm.sh/api';

const alteration: AlterationScript = {
  up: async (pool) => {
    await pool.query(sql`
      update resources
      set indicator = ${deploymentIndicator}
      where indicator ~ ${logtoIndicator};
    `);
  },
  down: async (pool) => {
    await pool.query(sql`
      update resources
      set indicator = regexp_replace(indicator, '^https://prysm\.sh/api$', 'https://\1.logto.app/api')
      where indicator ~ '^https://prysm\.sh/api$';
    `);
  },
};

export default alteration;

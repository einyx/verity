import { GlobalValues } from '@logto/shared';
import { sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

// Align the stored Cloud API resource indicator with the Cloud API / OIDC endpoint. It can differ
// from ADMIN_ENDPOINT in local and split-endpoint deployments, and OAuth rejects that mismatched audience.
const legacyIndicator = 'https://cloud.meshx.app/api';

const alteration: AlterationScript = {
  up: async (pool) => {
    const globalValues = new GlobalValues();
    const indicator = `${globalValues.cloudUrlSet.endpoint.origin}/api`;
    const previousAdminIndicator = `${globalValues.adminUrlSet.endpoint.origin}/api`;

    await pool.query(sql`
      update resources
      set indicator = ${indicator}
      where tenant_id = 'admin'
        and name = 'Logto Cloud API'
        and indicator in (${legacyIndicator}, ${previousAdminIndicator});
    `);
  },
  down: async () => {
    // The prior endpoint is environment-specific, so this alignment is not reversible safely.
  },
};

export default alteration;

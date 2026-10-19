import { sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

// The admin tenant's sign-in experience was seeded with Logto's dark logo, so the dark theme showed
// Logto while the light theme showed meshX. Remove that stale value so the dark theme falls back to the
// meshX logo. Only the seeded Logto dark logo is removed; any custom dark logo is kept.
const adminTenantId = 'admin';
const seededLogtoDarkLogoUrl = 'https://logto.io/logo-dark.svg';

const alteration: AlterationScript = {
  up: async (pool) => {
    await pool.query(sql`
      update sign_in_experiences
      set branding = branding - 'darkLogoUrl'
      where tenant_id = ${adminTenantId}
        and branding->>'darkLogoUrl' = ${seededLogtoDarkLogoUrl};
    `);
  },
  down: async () => {
    // The seeded Logto dark logo is not restored on rollback.
  },
};

export default alteration;

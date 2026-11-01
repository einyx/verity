import { sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

// The admin tenant's sign-in experience was seeded with Logto's dark logo, so the dark theme showed
// Logto. Replace only that seeded value with the white Prysm logo for dark backgrounds. A custom dark
// logo set by an operator is kept.
const adminTenantId = 'admin';
const seededLogtoDarkLogoUrl = 'https://logto.io/logo-dark.svg';
const prysmDarkLogoUrl = 'https://auth.prysm.sh:8443/console/prysm-logo-dark.svg';

const alteration: AlterationScript = {
  up: async (pool) => {
    await pool.query(sql`
      update sign_in_experiences
      set branding = jsonb_set(branding, '{darkLogoUrl}', to_jsonb(${prysmDarkLogoUrl}::text))
      where tenant_id = ${adminTenantId}
        and branding->>'darkLogoUrl' = ${seededLogtoDarkLogoUrl};
    `);
  },
  down: async () => {
    // The Prysm dark logo is not reverted to the seeded Logto logo on rollback.
  },
};

export default alteration;

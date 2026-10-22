import { sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

// The admin tenant's sign-in experience was seeded with Logto's dark logo, so the dark theme showed
// Logto. Replace only that seeded value with the white meshX logo for dark backgrounds. A custom dark
// logo set by an operator is kept.
const adminTenantId = 'admin';
const seededLogtoDarkLogoUrl = 'https://logto.io/logo-dark.svg';
const meshxDarkLogoUrl = 'https://console.meshx.foundation/console/meshx-logo-dark.svg';

const alteration: AlterationScript = {
  up: async (pool) => {
    await pool.query(sql`
      update sign_in_experiences
      set branding = jsonb_set(branding, '{darkLogoUrl}', to_jsonb(${meshxDarkLogoUrl}::text))
      where tenant_id = ${adminTenantId}
        and branding->>'darkLogoUrl' = ${seededLogtoDarkLogoUrl};
    `);
  },
  down: async () => {
    // The meshX dark logo is not reverted to the seeded Logto logo on rollback.
  },
};

export default alteration;

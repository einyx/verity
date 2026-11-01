import { useEffect } from 'react';

import { adminTenantEndpoint } from '@/consts';

/**
 * Redirects to the Account Center landing, which selects an available configured tab.
 */
function RedirectToAccountCenter() {
  useEffect(() => {
    const accountUrl = new URL('/account', adminTenantEndpoint.href);
    // eslint-disable-next-line @silverhand/fp/no-mutation
    window.location.href = accountUrl.toString();
  }, []);

  return null;
}

export default RedirectToAccountCenter;

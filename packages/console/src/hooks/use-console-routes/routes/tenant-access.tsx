import { type RouteObject } from 'react-router-dom';
import { safeLazy } from 'react-safe-lazy';

const TenantAccess = safeLazy(async () => import('@/cloud/pages/TenantAccess'));

// Who may manage customer tenants. Cloud only, admin tenant only.
export const tenantAccess: RouteObject = {
  path: 'tenant-access',
  element: <TenantAccess />,
};

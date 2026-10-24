import { type RouteObject } from 'react-router-dom';
import { safeLazy } from 'react-safe-lazy';

const Leads = safeLazy(async () => import('@/cloud/pages/Leads'));

// Leads from the landing demo chat. Cloud only, admin tenant only.
export const leads: RouteObject = {
  path: 'leads',
  element: <Leads />,
};

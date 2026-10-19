import { type RouteObject } from 'react-router-dom';
import { safeLazy } from 'react-safe-lazy';

const LandingPageEditor = safeLazy(async () => import('@/cloud/pages/LandingPageEditor'));

// The marketing site landing page editor. Cloud only.
export const landingPage: RouteObject = {
  path: 'landing-page',
  element: <LandingPageEditor />,
};

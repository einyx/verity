import { type RouteObject } from 'react-router-dom';
import { safeLazy } from 'react-safe-lazy';

const LandingPageEditor = safeLazy(async () => import('@/cloud/pages/LandingPageEditor'));

// The marketing site's landing page copy. Cloud only, behind the dev-feature flag like its editor API.
export const landingPage: RouteObject = {
  path: 'landing-page',
  element: <LandingPageEditor />,
};

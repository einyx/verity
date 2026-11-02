import { renderHook } from '@testing-library/react';
import { type ReactNode, type lazy } from 'react';
import { MemoryRouter } from 'react-router-dom';

import { type EnvTestUtils, mockEnv, resetMockEnv } from '@/test-utils/env';

import { useConsoleRoutes } from './index';

jest.mock('@/consts/env', () => jest.requireActual<EnvTestUtils>('@/test-utils/env').mockEnvModule);
jest.mock('react-safe-lazy', () => ({
  safeLazy: jest.requireActual<{ lazy: typeof lazy }>('react').lazy,
}));
jest.mock('@/components/ConsoleNotFound', () => ({ __esModule: true, default: () => null }));
jest.mock('@/hooks/use-is-actions-enabled', () => ({ __esModule: true, default: () => false }));
jest.mock('./routes/tenant-settings', () => ({ useTenantSettings: () => [] }));
// Route registration does not render authenticated infrastructure content.
jest.mock('@/pages/Kubo/KuboAccess', () => ({ __esModule: true, default: () => null }));

const wrapper = ({ children }: { readonly children: ReactNode }) => (
  <MemoryRouter>{children}</MemoryRouter>
);
afterEach(() => {
  resetMockEnv();
});

it('registers the Cloud landing-page editor route with dev features disabled', () => {
  mockEnv({ isCloud: true, isProduction: true, isDevFeaturesEnabled: false });
  const { result } = renderHook(() => useConsoleRoutes(), { wrapper });
  expect(result.current.map(({ path }) => path)).toContain('landing-page');
});

it('does not register the landing-page editor route outside Cloud', () => {
  mockEnv({ isCloud: false, isProduction: true, isDevFeaturesEnabled: false });
  const { result } = renderHook(() => useConsoleRoutes(), { wrapper });
  expect(result.current.map(({ path }) => path)).not.toContain('landing-page');
});

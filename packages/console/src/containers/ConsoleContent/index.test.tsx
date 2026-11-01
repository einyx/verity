import { fireEvent, render, screen } from '@testing-library/react';
import * as ReactTypes from 'react';
import { MemoryRouter, Route, Routes, Outlet } from 'react-router-dom';

import { type EnvTestUtils, mockEnv, resetMockEnv } from '@/test-utils/env';

import AppContent from '../AppContent';

import ConsoleContent from './index';

jest.mock('@/scss/modal.module.scss', () => ({}));

// Match AppContent's existing outlet contract without a signed-in backend.

jest.mock('react-safe-lazy', () => ({
  safeLazy: jest.requireActual<typeof ReactTypes>('react').lazy,
}));

jest.mock('@/consts/env', () => jest.requireActual<EnvTestUtils>('@/test-utils/env').mockEnvModule);
jest.mock('@/contexts/TenantsProvider', () => ({
  TenantsContext: ReactTypes.createContext({
    currentTenantId: 'customer',
    currentTenant: { isSuspended: false },
  }),
  GlobalRoute: { ConsoleSso: '/console-sso', SelfHostedLicenses: '/licenses' },
}));
jest.mock('@/contexts/SubscriptionDataProvider', () => {
  const value = { currentSubscriptionQuota: { actionsEnabled: false } };
  const SubscriptionDataContext = ReactTypes.createContext(value);
  return {
    __esModule: true,
    SubscriptionDataContext,
    default: ({ children }: { readonly children: ReactTypes.ReactNode }) => (
      <SubscriptionDataContext.Provider value={value}>{children}</SubscriptionDataContext.Provider>
    ),
  };
});
jest.mock('@/contexts/SubscriptionDataProvider/use-subscription-data', () => ({
  __esModule: true,
  default: () => ({ isLoading: false }),
}));
jest.mock('../AppContent/TenantNotificationContainer', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../AppContent/TenantSuspendedPage', () => ({
  __esModule: true,
  default: () => <p>Suspended tenant</p>,
}));
jest.mock('@/hooks/use-admin-console-tour', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/hooks/use-plausible-pageview', () => ({ usePlausiblePageview: jest.fn() }));
jest.mock('./hooks', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/hooks/use-theme', () => ({ __esModule: true, default: () => 'light' }));
jest.mock('@/hooks/use-user-preferences', () => ({
  __esModule: true,
  default: () => ({ data: { language: 'en' }, update: jest.fn() }),
}));
jest.mock('@/hooks/use-documentation-url', () => ({
  __esModule: true,
  default: () => ({ documentationSiteUrl: 'https://docs.example.test' }),
}));
jest.mock('@/components/Topbar/TenantSelector', () => ({
  __esModule: true,
  default: () => <button type="button">Current tenant</button>,
}));
jest.mock('@/components/Topbar/AiChat', () => ({
  __esModule: true,
  default: () => <button type="button">Assistant runtime</button>,
}));
jest.mock('@/hooks/use-current-user', () => ({
  __esModule: true,
  default: () => ({ user: { name: 'Local reviewer' }, isLoading: false }),
}));
jest.mock('@/hooks/use-sign-out', () => ({
  __esModule: true,
  default: () => ({ signOut: jest.fn() }),
}));
jest.mock('@/hooks/use-redirect-uri', () => ({
  __esModule: true,
  default: () => new URL('http://localhost/'),
}));
jest.mock('@/cloud/hooks/use-self-hosted-licenses', () => ({
  useSelfHostedLicenses: () => ({ data: [] }),
}));
jest.mock('@/components/Topbar/EnterpriseSubscriptions', () => ({
  __esModule: true,
  default: () => <button type="button">Subscription</button>,
}));
jest.mock('@/components/Topbar/ContactModal', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/HostedEmailCapBanner', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/OssLicenseBanner', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/OssTenantMfaBanner', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/ReadOnlyAccessNotification', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/ds-components/OverlayScrollbar', () => ({
  __esModule: true,
  default: ({ children }: { readonly children: ReactTypes.ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/hooks/use-console-routes', () => ({
  useConsoleRoutes: () => [
    { path: '*', element: <textarea aria-label="Unsaved editor" defaultValue="Draft" /> },
  ],
}));

beforeEach(() => {
  window.localStorage.clear();
  mockEnv({ isCloud: true, isDevFeaturesEnabled: false });
});
afterEach(resetMockEnv);

it('frames the existing editor with one scope/assistant and a real nested-route breadcrumb', async () => {
  render(
    <MemoryRouter initialEntries={['/customer/infrastructure/capacity/new']}>
      <Routes>
        <Route path="/:tenantId/*" element={<ConsoleContentWithContext />} />
      </Routes>
    </MemoryRouter>
  );
  const editor = screen.getByRole('textbox', { name: 'Unsaved editor' });
  fireEvent.change(editor, { target: { value: 'Dirty work' } });
  expect(await screen.findAllByRole('button', { name: 'Current tenant' })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'Assistant runtime' })).toHaveLength(1);
  expect(screen.getByRole('navigation', { name: 'Current page' }).textContent).toContain(
    'admin_console.tabs.capacity'
  );
  expect(
    screen.getByRole('link', { name: 'admin_console.tabs.capacity' }).getAttribute('aria-current')
  ).toBe('page');
  fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
  expect(editor).toHaveProperty('value', 'Dirty work');
  expect(screen.queryByRole('button', { name: /create new/i })).toBeNull();
  expect(screen.getByRole('button', { name: 'admin_console.menu.profile' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Subscription' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'admin_console.menu.language' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'admin_console.topbar.docs' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'admin_console.topbar.help' })).toBeTruthy();
});

function ConsoleContentWithContext() {
  return (
    <Routes>
      <Route element={<ContextOutlet />}>
        <Route path="*" element={<ConsoleContent />} />
      </Route>
    </Routes>
  );
}
function ContextOutlet() {
  return <Outlet context={{ scrollableContent: { current: null } }} />;
}

it('renders a usable standalone topbar for suspended tenants without active-console chrome', async () => {
  const { TenantsContext } = jest.requireMock<{
    TenantsContext: ReactTypes.Context<{
      currentTenantId: string;
      currentTenant: { isSuspended: boolean };
    }>;
  }>('@/contexts/TenantsProvider');
  render(
    <MemoryRouter>
      <TenantsContext.Provider
        value={{ currentTenantId: 'customer', currentTenant: { isSuspended: true } }}
      >
        <AppContent />
      </TenantsContext.Provider>
    </MemoryRouter>
  );
  expect(await screen.findByText('Suspended tenant')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'Current tenant' })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'Assistant runtime' })).toHaveLength(1);
  expect(screen.queryByRole('complementary', { name: 'Console navigation' })).toBeNull();
  expect(screen.getByRole('button', { name: 'admin_console.menu.profile' })).toBeTruthy();
});

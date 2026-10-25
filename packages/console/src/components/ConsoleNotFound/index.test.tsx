import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router-dom';

import { type EnvTestUtils } from '@/test-utils/env';

import ConsoleNotFound from './index';

jest.mock('@/consts/env', () => jest.requireActual<EnvTestUtils>('@/test-utils/env').mockEnvModule);

jest.mock('@/hooks/use-theme', () => ({
  __esModule: true,
  default: () => 'light',
}));

const pagePaths = ['dashboard', 'leads', 'landing-page'];

function LocationDisplay() {
  const location = useLocation();

  return <div data-testid="location">{location.pathname}</div>;
}

const renderConsoleNotFound = (pathname: string) =>
  render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route path="/:tenantId" element={<Outlet />}>
          <Route path="dashboard" element={<LocationDisplay />} />
          <Route path="leads" element={<LocationDisplay />} />
          <Route path="*" element={<ConsoleNotFound pagePaths={pagePaths} />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );

describe('ConsoleNotFound', () => {
  it('sends a stale path back to the page it starts with', () => {
    renderConsoleNotFound('/admin/dashboard/leads/landing-page/landing-page/leads');

    expect(screen.getByTestId('location').textContent).toBe('/admin/dashboard');
  });

  it('renders the not-found page for a path that does not start with a page', () => {
    renderConsoleNotFound('/admin/dashbord');

    expect(screen.getByText(/page_not_found/)).not.toBeNull();
  });

  it('sends a path under a page back to that page', () => {
    renderConsoleNotFound('/admin/leads/landing-page');

    expect(screen.getByTestId('location').textContent).toBe('/admin/leads');
  });
});

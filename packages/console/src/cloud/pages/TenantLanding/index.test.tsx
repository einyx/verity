import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import TenantLanding from './index';

const mockGetIdTokenClaims = jest.fn();
const mockIsAuthenticated = jest.fn(() => true);

jest.mock('@logto/react', () => ({
  useLogto: () => ({
    isAuthenticated: mockIsAuthenticated(),
    getIdTokenClaims: mockGetIdTokenClaims,
  }),
}));
jest.mock('@/components/AppLoading', () => () => <div>loading</div>);

function TenantPage() {
  const { pathname } = useLocation();
  return <div>{pathname}</div>;
}

describe('TenantLanding', () => {
  it('opens the tenant the user is a member of', async () => {
    mockGetIdTokenClaims.mockResolvedValue({ organizations: ['t-admin'] });

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<TenantLanding />} />
          <Route path="/:tenantId" element={<TenantPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('/admin')).toBeTruthy();
    });
  });

  it('does not read missing claims for an anonymous visitor', async () => {
    mockGetIdTokenClaims.mockClear();
    mockIsAuthenticated.mockReturnValue(false);
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<TenantLanding />} />
          <Route path="/:tenantId" element={<TenantPage />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByText('/default')).toBeTruthy();
    });
    expect(mockGetIdTokenClaims).not.toHaveBeenCalled();
  });
});

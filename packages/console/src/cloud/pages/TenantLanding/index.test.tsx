import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import TenantLanding from './index';

const mockGetIdTokenClaims = jest.fn();

jest.mock('@logto/react', () => ({
  useLogto: () => ({ getIdTokenClaims: mockGetIdTokenClaims }),
}));

describe('TenantLanding', () => {
  it('opens the tenant the user is a member of', async () => {
    mockGetIdTokenClaims.mockResolvedValue({ organizations: ['t-admin'] });

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<TenantLanding />} />
          <Route path="/:tenantId" element={<div>tenant page</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('tenant page')).toBeTruthy();
    });
  });
});

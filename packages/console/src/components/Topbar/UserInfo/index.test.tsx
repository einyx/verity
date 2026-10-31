import { fireEvent, render, screen } from '@testing-library/react';
import ReactModal from 'react-modal';
import { MemoryRouter } from 'react-router-dom';

import UserInfo from '.';

jest.mock('@/consts/env', () => ({ isCloud: true }));
jest.mock('@/consts', () => ({ adminTenantEndpoint: new URL('https://auth.example.com') }));
jest.mock('@/hooks/use-theme', () => ({ __esModule: true, default: () => 'light' }));
jest.mock('@/scss/modal.module.scss', () => ({}));
jest.mock('@/cloud/hooks/use-self-hosted-licenses', () => ({
  useSelfHostedLicenses: () => ({ data: [], error: undefined }),
}));
jest.mock('@/hooks/use-current-user', () => ({
  __esModule: true,
  default: () => ({ user: { name: 'Test user' }, isLoading: false }),
}));
jest.mock('@/hooks/use-sign-out', () => ({
  __esModule: true,
  default: () => ({ signOut: jest.fn() }),
}));
jest.mock('@/hooks/use-redirect-uri', () => ({
  __esModule: true,
  default: () => new URL('https://console.example.com/console'),
}));
jest.mock('@/hooks/use-user-preferences', () => ({
  __esModule: true,
  default: () => ({ data: { language: 'en', appearanceMode: 'system' }, update: jest.fn() }),
}));

afterEach(() => {
  jest.restoreAllMocks();
});

it('opens console SSO with the router basename', () => {
  const open = jest.spyOn(window, 'open').mockImplementation(() => null);
  // JSDOM cannot compute pseudo-element styles used by the submenu scrollbar.
  const { getComputedStyle } = window;
  jest.spyOn(window, 'getComputedStyle').mockImplementation((element) => getComputedStyle(element));
  const { container } = render(
    <MemoryRouter
      basename="/console"
      initialEntries={['/console/default/dashboard']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <UserInfo />
    </MemoryRouter>
  );
  ReactModal.setAppElement(container);

  fireEvent.click(screen.getByRole('button'));
  fireEvent.click(screen.getByRole('menuitem', { name: 'admin_console.menu.single_sign_on' }));

  expect(open).toHaveBeenCalledWith('/console/console-sso', '_blank', 'noopener,noreferrer');
});

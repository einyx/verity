import { act, render, screen } from '@testing-library/react';
// eslint-disable-next-line no-restricted-imports -- isolated router fixture for the global callback page.
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import Callback from './index';

const mockGetIdTokenClaims = jest.fn().mockResolvedValue(undefined);
const mockClearAllTokens = jest.fn();
const mockHandleCallback = jest.fn<void, [() => void]>();

jest.mock('@logto/react', () => ({
  useLogto: () => ({
    getIdTokenClaims: mockGetIdTokenClaims,
    clearAllTokens: mockClearAllTokens,
  }),
  useHandleSignInCallback: (callback: () => void) => {
    mockHandleCallback(callback);
    return {};
  },
}));
jest.mock('@/components/AppLoading', () => () => <div>signing in</div>);
jest.mock('@/components/AppError', () => () => <div>sign-in error</div>);
jest.mock('@/ds-components/Button', () => () => <button type="button">retry</button>);
jest.mock('@/hooks/use-redirect-uri', () =>
  jest.fn().mockReturnValue(new URL('https://example.com/callback'))
);
jest.mock('@/utils/storage', () => ({ consumeSavedRedirect: jest.fn() }));

it('waits for the SDK exchange before opening the console, without probing missing claims', async () => {
  render(
    <MemoryRouter initialEntries={['/callback?code=test&state=test']}>
      <Routes>
        <Route path="/callback" element={<Callback />} />
        <Route path="/" element={<div>console</div>} />
      </Routes>
    </MemoryRouter>
  );

  expect(screen.getByText('signing in')).toBeTruthy();
  expect(mockGetIdTokenClaims).not.toHaveBeenCalled();
  expect(mockClearAllTokens).not.toHaveBeenCalled();

  await act(async () => {
    mockHandleCallback.mock.calls[0]?.[0]();
  });
  expect(screen.getByText('console')).toBeTruthy();
});

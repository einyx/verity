import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { type EnvTestUtils } from '@/test-utils/env';

import AppError from '.';

const clearAllTokens = jest.fn<Promise<void>, never[]>().mockResolvedValue(undefined);
const signIn = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);

jest.mock('@logto/react', () => ({
  useLogto: () => ({ clearAllTokens, signIn }),
}));
jest.mock('@/hooks/use-theme', () => ({ __esModule: true, default: () => 'light' }));
jest.mock('@/consts/env', () => jest.requireActual<EnvTestUtils>('@/test-utils/env').mockEnvModule);

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  window.history.replaceState({}, '', '/');
});

it.each(['/callback', '/console/callback'])(
  'starts a new sign-in from %s rather than reloading the failed callback parameters',
  async (path) => {
    window.history.replaceState(
      {},
      '',
      `${path}?error=invalid_target&state=old-state#old-fragment`
    );
    render(<AppError errorCode="invalid_target" errorMessage="Resource indicator is unknown" />);
    expect(signIn).not.toHaveBeenCalled();
    expect(clearAllTokens).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith(`${window.location.origin}${path}`);
    });
    expect(clearAllTokens).toHaveBeenCalledTimes(1);
    expect(signIn).toHaveBeenCalledTimes(1);
  }
);

it('keeps ordinary non-callback error recovery as a reload', async () => {
  window.history.replaceState({}, '', '/console/default/dashboard');
  const descriptor = Object.getOwnPropertyDescriptor(window, 'location');
  if (!descriptor) {
    throw new Error('The test environment must provide window.location');
  }
  const reload = jest.fn();
  // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- Isolates jsdom navigation so the test can verify reload without leaving the page.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload },
  });
  try {
    render(<AppError errorMessage="An unrelated error" />);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => {
      expect(reload).toHaveBeenCalledTimes(1);
    });
    expect(clearAllTokens).toHaveBeenCalledTimes(1);
    expect(signIn).not.toHaveBeenCalled();
  } finally {
    // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- Restores the exact original location descriptor after the isolated test.
    Object.defineProperty(window, 'location', descriptor);
  }
});

import { LogtoError, Prompt, useHandleSignInCallback, useLogto } from '@logto/react';
import { AccountCenterControlValue } from '@logto/schemas';
import { fireEvent } from '@testing-library/react';
import { type ReactElement, type ReactNode } from 'react';

import AccountLayout from './AccountLayout';
import { Main } from './App';
import renderWithPageContext, {
  mockAccountCenterSettings,
} from './__mocks__/RenderWithPageContext';
import { sessionStorage as accountStorage } from './utils/session-storage';

jest.mock('@ac/constants/env', () => ({
  __esModule: true,
  isDevFeaturesEnabled: false,
}));

// Note: jest.requireActual('@logto/react') can't be used here, as it pulls in
// @logto/client → @logto/js, which fails to resolve under the monorepo's
// pnpm/jest module layout. Prompt/ReservedScope/UserScope are OIDC/OAuth
// spec-defined string constants, so the literal values below are stable.
jest.mock('@logto/react', () => ({
  __esModule: true,
  Prompt: { None: 'none', Login: 'login', Consent: 'consent', SelectAccount: 'select_account' },
  ReservedScope: { OpenId: 'openid', OfflineAccess: 'offline_access' },
  UserScope: {
    Profile: 'profile',
    Email: 'email',
    Phone: 'phone',
    Address: 'address',
    CustomData: 'custom_data',
    Identities: 'identities',
  },
  LogtoProvider: ({ children }: { readonly children: ReactNode }): ReactElement => {
    const React = jest.requireActual('react') as unknown as {
      createElement: (type: unknown, props: undefined, ...children: ReactNode[]) => ReactElement;
      Fragment: unknown;
    };
    return React.createElement(React.Fragment, undefined, children);
  },
  LogtoError: class LogtoError extends Error {},
  LogtoClientError: class LogtoClientError extends Error {},
  LogtoRequestError: class LogtoRequestError extends Error {},
  useLogto: jest.fn(),
  useHandleSignInCallback: jest.fn(() => ({ error: undefined })),
}));

jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom') as unknown as Record<string, unknown>;
  const React = jest.requireActual('react') as unknown as {
    createElement: (type: string, props: Record<string, string>) => unknown;
  };

  return {
    __esModule: true,
    ...actual,
    Navigate: ({ to }: { readonly to: string }) =>
      React.createElement('div', { 'data-testid': 'navigate', 'data-to': to }),
  };
});

const setLocation = (pathname: string, search = '') => {
  // eslint-disable-next-line @silverhand/fp/no-mutating-methods
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      pathname,
      search,
      origin: 'http://localhost',
      assign: jest.fn(),
      replace: jest.fn(),
    },
  });
};

type UseLogtoReturn = {
  isAuthenticated: boolean;
  isLoading: boolean;
  signIn: jest.Mock;
  clearAllTokens: jest.Mock;
};

const setupUseLogto = (overrides: Partial<UseLogtoReturn> = {}): UseLogtoReturn => {
  const value: UseLogtoReturn = {
    isAuthenticated: true,
    isLoading: false,
    signIn: jest.fn(),
    clearAllTokens: jest.fn(),
    ...overrides,
  };
  (useLogto as jest.Mock).mockReturnValue(value);
  return value;
};

describe('Account Center <Main /> auth-redirect effects', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('userInfoError while authenticated', () => {
    it('attempts silent re-auth via Prompt.None when account center is enabled', () => {
      setLocation('/account/profile');
      const { signIn } = setupUseLogto();

      renderWithPageContext(
        <Main />,
        { initialEntries: ['/profile'] },
        { pageContext: { userInfoError: new Error('userinfo failed') } }
      );

      expect(signIn).toHaveBeenCalledTimes(1);
      expect(signIn).toHaveBeenCalledWith(expect.objectContaining({ prompt: Prompt.None }));
    });

    it('does not trigger any signIn when account center is disabled', () => {
      setLocation('/account');
      const { signIn } = setupUseLogto();

      renderWithPageContext(
        <Main />,
        { initialEntries: ['/account'] },
        {
          pageContext: {
            userInfoError: new Error('userinfo failed'),
            accountCenterSettings: { ...mockAccountCenterSettings, enabled: false },
          },
        }
      );

      expect(signIn).not.toHaveBeenCalled();
    });
  });

  describe('silent re-auth failure fallback', () => {
    it('keeps error recovery explicit rather than dropping the query in a tab redirect', () => {
      setLocation('/account', '?error=login_required');
      const { signIn } = setupUseLogto({ isAuthenticated: false });

      const { queryByTestId } = renderWithPageContext(
        <Main />,
        { initialEntries: ['/account?error=login_required'] },
        {
          pageContext: {
            accountCenterSettings: {
              ...mockAccountCenterSettings,
              profileFields: [{ name: 'name' }],
            },
          },
        }
      );

      expect(queryByTestId('navigate')).toBeNull();
      expect(useHandleSignInCallback).not.toHaveBeenCalled();
      expect(signIn).not.toHaveBeenCalled();
    });

    it('does not trigger any signIn when account center is disabled', () => {
      setLocation('/account', '?error=login_required');
      const { signIn } = setupUseLogto({ isAuthenticated: false });

      renderWithPageContext(
        <Main />,
        { initialEntries: ['/account?error=login_required'] },
        {
          pageContext: {
            accountCenterSettings: { ...mockAccountCenterSettings, enabled: false },
          },
        }
      );

      expect(signIn).not.toHaveBeenCalled();
    });
  });

  describe('unauthenticated landing', () => {
    it('starts a regular sign-in without a prompt when landing on a tab', () => {
      setLocation('/account/profile');
      const { signIn } = setupUseLogto({ isAuthenticated: false });

      renderWithPageContext(<Main />, { initialEntries: ['/profile'] }, { pageContext: {} });

      expect(signIn).toHaveBeenCalledTimes(1);
      expect(signIn.mock.calls[0]?.[0]).toEqual(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        expect.objectContaining({ redirectUri: expect.any(String) })
      );
      expect(signIn.mock.calls[0]?.[0]?.prompt).toBeUndefined();
    });
  });

  describe('root account route redirect', () => {
    it('keeps a confirmed disabled Account Center distinct from a retryable load error', () => {
      setLocation('/account');
      const { signIn } = setupUseLogto({ isAuthenticated: false });
      const { getByText, queryByRole } = renderWithPageContext(
        <Main />,
        { initialEntries: ['/'] },
        {
          pageContext: { accountCenterSettings: { ...mockAccountCenterSettings, enabled: false } },
        }
      );
      expect(getByText('account_center.home.title')).toBeTruthy();
      expect(
        queryByRole('button', { name: 'account_center.security.trusted_devices.retry' })
      ).toBeNull();
      expect(signIn).not.toHaveBeenCalled();
    });

    it('redirects a hidden profile deep link to Security without changing configured fields', () => {
      setLocation('/account/profile');
      setupUseLogto();
      const settings = {
        ...mockAccountCenterSettings,
        profileFields: [],
        fields: { ...mockAccountCenterSettings.fields, session: AccountCenterControlValue.Off },
      };
      const { getByTestId } = renderWithPageContext(
        <Main />,
        { initialEntries: ['/profile'] },
        { pageContext: { accountCenterSettings: settings } }
      );
      expect(getByTestId('navigate').dataset.to).toBe('/security');
      expect(settings.profileFields).toEqual([]);
      expect(settings.fields.session).toBe(AccountCenterControlValue.Off);
    });

    it('shows a retryable settings error instead of Home and does not start authentication', () => {
      setLocation('/account/profile');
      const { signIn } = setupUseLogto({ isAuthenticated: false });
      const reloadSettings = jest.fn();
      const { getByRole, queryByText } = renderWithPageContext(
        <Main />,
        { initialEntries: ['/profile'] },
        { pageContext: { experienceError: new Error('private diagnostic'), reloadSettings } }
      );
      expect(queryByText('account_center.home.title')).toBeNull();
      expect(queryByText('private diagnostic')).toBeNull();
      fireEvent.click(
        getByRole('button', { name: 'account_center.security.trusted_devices.retry' })
      );
      expect(reloadSettings).toHaveBeenCalledTimes(1);
      expect(signIn).not.toHaveBeenCalled();
    });

    it('does not silently reauthenticate against stale settings during a failed load', () => {
      setLocation('/account/security');
      const { signIn } = setupUseLogto();
      renderWithPageContext(
        <Main />,
        { initialEntries: ['/security'] },
        {
          pageContext: { experienceError: new Error('offline'), userInfoError: new Error('stale') },
        }
      );
      expect(signIn).not.toHaveBeenCalled();
    });

    it('redirects to the profile tab when it is available', () => {
      setLocation('/account');
      const { signIn } = setupUseLogto({ isAuthenticated: false, isLoading: true });

      const { getByTestId } = renderWithPageContext(
        <Main />,
        { initialEntries: ['/account'] },
        {
          pageContext: {
            accountCenterSettings: {
              ...mockAccountCenterSettings,
              profileFields: [{ name: 'name' }],
            },
            userInfo: undefined,
            isLoadingUserInfo: true,
          },
        }
      );

      expect(getByTestId('navigate').dataset.to).toBe('/profile');
      expect(signIn).not.toHaveBeenCalled();
    });

    it('redirects to the security tab when profile is unavailable', () => {
      setLocation('/account');
      setupUseLogto({ isAuthenticated: false });

      const { getByTestId } = renderWithPageContext(
        <Main />,
        { initialEntries: ['/account'] },
        {
          pageContext: {
            accountCenterSettings: {
              ...mockAccountCenterSettings,
              profileFields: [],
            },
          },
        }
      );

      expect(getByTestId('navigate').dataset.to).toBe('/security');
    });

    it('redirects to the sessions tab when profile and security are unavailable', () => {
      setLocation('/account');
      setupUseLogto({ isAuthenticated: false });

      const { getByTestId } = renderWithPageContext(
        <Main />,
        { initialEntries: ['/account'] },
        {
          pageContext: {
            accountCenterSettings: {
              ...mockAccountCenterSettings,
              profileFields: [],
              fields: {
                ...mockAccountCenterSettings.fields,
                email: AccountCenterControlValue.Off,
                mfa: AccountCenterControlValue.Off,
                password: AccountCenterControlValue.Off,
                phone: AccountCenterControlValue.Off,
                session: AccountCenterControlValue.Edit,
                username: AccountCenterControlValue.Off,
              },
            },
          },
        }
      );

      expect(getByTestId('navigate').dataset.to).toBe('/sessions');
    });

    it('shows the home error page when no tab is available', () => {
      setLocation('/account');
      const { signIn } = setupUseLogto({ isAuthenticated: false });

      const { getByText } = renderWithPageContext(
        <Main />,
        { initialEntries: ['/account'] },
        {
          pageContext: {
            accountCenterSettings: {
              ...mockAccountCenterSettings,
              profileFields: [],
              fields: {
                ...mockAccountCenterSettings.fields,
                email: AccountCenterControlValue.Off,
                mfa: AccountCenterControlValue.Off,
                password: AccountCenterControlValue.Off,
                phone: AccountCenterControlValue.Off,
                session: AccountCenterControlValue.Off,
                username: AccountCenterControlValue.Off,
              },
            },
          },
        }
      );

      expect(getByText('account_center.home.title')).toBeTruthy();
      expect(signIn).not.toHaveBeenCalled();
    });
  });

  describe('auth callback in flight', () => {
    it('does not let the layout boundary auto-sign-in on a shared SDK callback error', () => {
      setLocation('/account', '?error=login_required&state=original');
      const value = setupUseLogto({ isAuthenticated: false });
      const error = new LogtoError('callback_uri_verification.state_mismatched');
      (useLogto as jest.Mock).mockReturnValue({ ...value, error });
      accountStorage.setRouteRestore('/account/password');
      const { getByRole } = renderWithPageContext(
        <AccountLayout>
          <Main />
        </AccountLayout>,
        { initialEntries: ['/'] }
      );
      expect(getByRole('button', { name: 'action.sign_in' })).toBeTruthy();
      expect(value.signIn).not.toHaveBeenCalled();
      expect(value.clearAllTokens).not.toHaveBeenCalled();
      expect(accountStorage.getRouteRestore()).toBe('/account/password');
      fireEvent.click(getByRole('button', { name: 'action.sign_in' }));
      expect(window.location.replace).toHaveBeenCalledWith('/account');
      expect(accountStorage.getRouteRestore()).toBe('/account/password');
      accountStorage.clearRouteRestore();
    });

    it('does not discard other OAuth error callbacks or launch a new sign-in', () => {
      setLocation('/account', '?error=access_denied&state=original');
      const { signIn } = setupUseLogto({ isAuthenticated: false });
      const { queryByTestId } = renderWithPageContext(<Main />, { initialEntries: ['/'] });
      expect(useHandleSignInCallback).not.toHaveBeenCalled();
      expect(queryByTestId('navigate')).toBeNull();
      expect(signIn).not.toHaveBeenCalled();
    });
    it('does not fire the auth-redirect signIn while handling the ?code= callback', () => {
      setLocation('/account', '?code=abc123');
      const { signIn } = setupUseLogto({ isAuthenticated: false });

      renderWithPageContext(
        <Main />,
        { initialEntries: ['/account?code=abc123'] },
        { pageContext: { userInfoError: new Error('still loading') } }
      );

      expect(signIn).not.toHaveBeenCalled();
    });
  });
});

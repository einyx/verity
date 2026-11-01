import { Prompt, useLogto } from '@logto/react';
import { ExtraParamsKey } from '@logto/schemas';
import { useContext, useEffect, useRef } from 'react';

import PageContext from './Providers/PageContextProvider/PageContext';
import { accountCenterBasePath, getUiLocales, setRouteRestore } from './utils/account-center-route';

const redirectUri = `${window.location.origin}${accountCenterBasePath}`;

type UseAuthRedirectProps = {
  readonly isInCallback: boolean;
};

/**
 * Drives Account Center's auth redirect lifecycle:
 *
 * - Unauthenticated landing → kick off a normal sign-in.
 * - `userInfoError` while authenticated → try a silent OIDC re-auth (`Prompt.None`)
 *   so a user with a valid session cookie (e.g. the User B side of a user-switch
 *   with stale local tokens) is recovered without an interactive login.
 * - OAuth errors require explicit recovery; untrusted query parameters never
 *   clear SDK credentials or trigger an automatic replacement login.
 *
 * All branches are gated on `accountCenterSettings?.enabled` to preserve the
 * disabled-tenant short-circuit added in #8637. When disabled, both effects
 * are no-ops and `App.tsx` renders the disabled UI; the `?error=login_required`
 * query param is left in the URL in that case, which is harmless because no
 * further redirect is issued.
 */
export const useAuthRedirect = ({ isInCallback }: UseAuthRedirectProps): void => {
  const uiLocales = getUiLocales();
  const { isAuthenticated, isLoading, signIn } = useLogto();
  const {
    accountCenterSettings,
    experienceSettings,
    experienceError,
    isLoadingExperience,
    isLoadingUserInfo,
    userInfoError,
  } = useContext(PageContext);
  const isInitialAuthLoading = !isAuthenticated && isLoading;
  const hasAttemptedSilentReauth = useRef(false);
  const settingsReady = Boolean(experienceSettings) && !experienceError && !isLoadingExperience;

  useEffect(() => {
    if (isInCallback || isInitialAuthLoading || !settingsReady) {
      return;
    }

    const extraParams = uiLocales ? { [ExtraParamsKey.UiLocales]: uiLocales } : undefined;

    if (!isAuthenticated && accountCenterSettings?.enabled) {
      setRouteRestore(window.location.pathname);
      void signIn({ redirectUri, extraParams });
    }
  }, [
    isAuthenticated,
    isInCallback,
    isInitialAuthLoading,
    settingsReady,
    accountCenterSettings,
    signIn,
    uiLocales,
  ]);

  useEffect(() => {
    if (isInCallback || !settingsReady) {
      return;
    }
    if (isInitialAuthLoading || !isAuthenticated || isLoadingUserInfo) {
      return;
    }

    // Skip re-authentication when account center is disabled - the API will always reject.
    // Otherwise let the OIDC provider decide: silent re-auth via the session cookie if
    // possible. On failure the callback UI provides explicit recovery.
    //
    // Guard with a ref so this fires at most once per page load: userInfoError
    // stays truthy until navigation, so without the guard every dependency
    // change would re-dispatch signIn and keep overwriting the saved route.
    if (userInfoError && accountCenterSettings?.enabled && !hasAttemptedSilentReauth.current) {
      // eslint-disable-next-line @silverhand/fp/no-mutation
      hasAttemptedSilentReauth.current = true;
      const extraParams = uiLocales ? { [ExtraParamsKey.UiLocales]: uiLocales } : undefined;
      setRouteRestore(window.location.pathname);
      void signIn({ redirectUri, prompt: Prompt.None, extraParams });
    }
  }, [
    accountCenterSettings,
    settingsReady,
    isAuthenticated,
    isInCallback,
    isInitialAuthLoading,
    isLoadingUserInfo,
    signIn,
    uiLocales,
    userInfoError,
  ]);
};

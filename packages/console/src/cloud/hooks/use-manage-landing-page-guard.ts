import { Prompt, useLogto } from '@logto/react';
import { useCallback } from 'react';

import { cloudApi } from '@/consts/resources';
import { storageKeys } from '@/consts/storage';
import useRedirectUri from '@/hooks/use-redirect-uri';
import { saveRedirect } from '@/utils/storage';

/**
 * Re-consent (at most once per tab) when a session predates the landing-page editor's Cloud API scope.
 * Subsequent checks (including on tenant switches) will not re-trigger the sign-in flow.
 */
const useManageLandingPageGuard = () => {
  const { clearAllTokens, getAccessTokenClaims, signIn } = useLogto();
  const redirectUri = useRedirectUri();

  return useCallback(async () => {
    const claims = await getAccessTokenClaims(cloudApi.indicator);
    const scopes = claims?.scope?.split(' ') ?? [];

    if (scopes.includes(cloudApi.scopes.ManageLandingPage)) {
      return true;
    }

    if (sessionStorage.getItem(storageKeys.manageLandingPageReconsentAttempted)) {
      // We already tried (or the session predates the scope). Do not render the
      // protected UI to avoid 403s on the API calls, which the global error
      // handler turns into a full sign-out. The user stays signed in; they just
      // don't get the editor (or see a permission error if we choose to render one).
      return false;
    }

    sessionStorage.setItem(storageKeys.manageLandingPageReconsentAttempted, 'true');
    saveRedirect(new URL(window.location.href));
    await clearAllTokens();
    void signIn({ redirectUri: redirectUri.href, prompt: Prompt.Consent });
    return false;
  }, [clearAllTokens, getAccessTokenClaims, redirectUri.href, signIn]);
};

export default useManageLandingPageGuard;

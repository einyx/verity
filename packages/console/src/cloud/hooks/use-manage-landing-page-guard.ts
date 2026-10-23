import { Prompt, useLogto } from '@logto/react';
import { useCallback } from 'react';

import { cloudApi } from '@/consts/resources';
import { storageKeys } from '@/consts/storage';
import useRedirectUri from '@/hooks/use-redirect-uri';
import { saveRedirect } from '@/utils/storage';

/** Re-consent once when a session predates the landing-page editor's Cloud API scope. */
const useManageLandingPageGuard = () => {
  const { clearAllTokens, getAccessTokenClaims, signIn } = useLogto();
  const redirectUri = useRedirectUri();

  return useCallback(async () => {
    const claims = await getAccessTokenClaims(cloudApi.indicator);
    const scopes = claims?.scope?.split(' ') ?? [];

    if (scopes.includes(cloudApi.scopes.ManageLandingPage)) {
      sessionStorage.removeItem(storageKeys.manageLandingPageReconsentAttempted);
      return true;
    }

    if (sessionStorage.getItem(storageKeys.manageLandingPageReconsentAttempted)) {
      return true;
    }

    sessionStorage.setItem(storageKeys.manageLandingPageReconsentAttempted, 'true');
    saveRedirect(new URL(window.location.href));
    await clearAllTokens();
    void signIn({ redirectUri: redirectUri.href, prompt: Prompt.Consent });
    return false;
  }, [clearAllTokens, getAccessTokenClaims, redirectUri.href, signIn]);
};

export default useManageLandingPageGuard;

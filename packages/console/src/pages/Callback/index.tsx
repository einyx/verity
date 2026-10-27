import { useHandleSignInCallback, useLogto } from '@logto/react';
import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import AppError from '@/components/AppError';
import AppLoading from '@/components/AppLoading';
import Button from '@/ds-components/Button';
import useRedirectUri from '@/hooks/use-redirect-uri';
import { consumeSavedRedirect } from '@/utils/storage';

/** The global callback page for all sign-in redirects from Logto main flow. */
function Callback() {
  const navigate = useNavigate();
  const { clearAllTokens, signIn } = useLogto();
  const [searchParams] = useSearchParams();
  const redirectUri = useRedirectUri();

  useEffect(() => {
    // IMPORTANT: Do not clear tokens when arriving with an auth code from the IdP.
    // useHandleSignInCallback will exchange the code and persist the (new) tokens.
    // Unconditionally clearing was wiping tokens immediately after exchange,
    // leaving the client "Not authenticated" after re-consent flows and causing
    // "state mismatched" errors on subsequent callbacks during tenant switches.
    if (!searchParams.get('code') && !searchParams.get('state')) {
      void clearAllTokens();
    }
  }, [clearAllTokens, searchParams]);

  const { error } = useHandleSignInCallback(() => {
    const saved = consumeSavedRedirect();

    if (saved) {
      // Saved redirect is full pathname, no need to use `getTo`.
      void navigate(saved, { replace: true });
      return;
    }

    void navigate('/', { replace: true });
  });

  // The code is spent, or the sign-in session is gone. The exchange failed, and without this the
  // page would spin for ever and say nothing.
  if (error) {
    return (
      <AppError errorMessage={error.message}>
        <Button
          title="general.retry"
          size="large"
          onClick={() => {
            void signIn(redirectUri.href);
          }}
        />
      </AppError>
    );
  }

  return <AppLoading />;
}

export default Callback;

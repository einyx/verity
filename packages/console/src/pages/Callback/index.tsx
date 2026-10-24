import { useHandleSignInCallback, useLogto } from '@logto/react';
import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import AppLoading from '@/components/AppLoading';
import { consumeSavedRedirect } from '@/utils/storage';

/** The global callback page for all sign-in redirects from Logto main flow. */
function Callback() {
  const navigate = useNavigate();
  const { clearAllTokens } = useLogto();
  const [searchParams] = useSearchParams();

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

  useHandleSignInCallback(() => {
    const saved = consumeSavedRedirect();

    if (saved) {
      // Saved redirect is full pathname, no need to use `getTo`.
      navigate(saved, { replace: true });
      return;
    }

    navigate('/', { replace: true });
  });

  return <AppLoading />;
}

export default Callback;

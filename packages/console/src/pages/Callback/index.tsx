import { useHandleSignInCallback, useLogto } from '@logto/react';
import { useCallback, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import AppError from '@/components/AppError';
import AppLoading from '@/components/AppLoading';
import Button from '@/ds-components/Button';
import useRedirectUri from '@/hooks/use-redirect-uri';
import { consumeSavedRedirect } from '@/utils/storage';

/** The global callback page for all sign-in redirects from Logto main flow. */
function Callback() {
  const navigate = useNavigate();
  const { clearAllTokens, getIdTokenClaims, signIn } = useLogto();
  const [searchParams] = useSearchParams();
  const redirectUri = useRedirectUri();
  const hasCode = Boolean(searchParams.get('code'));
  const signedIn = useRef(false);
  const left = useRef(false);
  const restarted = useRef(false);

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

  // Where the person goes once the sign-in is done. The first caller wins: the SDK and the check
  // below can both find the token.
  const onSignedIn = useCallback(() => {
    if (signedIn.current) {
      return;
    }

    // eslint-disable-next-line @silverhand/fp/no-mutation -- the first caller wins, and the refs are the only state a callback can carry.
    signedIn.current = true;
    const saved = consumeSavedRedirect();

    navigate(saved ?? '/', { replace: true });
  }, [navigate]);

  const { error } = useHandleSignInCallback(onSignedIn);

  // The SDK only exchanges the code when the client is not signed in yet. A browser that still
  // holds somebody else's session would leave the code unexchanged, so the page waits for the
  // token, finds none, and starts over once with the other session gone.
  useEffect(() => {
    if (error ?? !hasCode) {
      return;
    }

    const check = async (attempt: number): Promise<void> => {
      const claims = await getIdTokenClaims().catch(() => null);

      if (claims) {
        // The SDK stores the tokens before it tells the page, and it can stop right there. The token
        // is the proof that the sign-in happened, so the page goes on its way with or without it.
        await new Promise((resolve) => {
          setTimeout(resolve, 250);
        });

        if (!left.current) {
          onSignedIn();
        }

        return;
      }

      if (attempt >= 40) {
        // No token and no exchange: the client is signed in as somebody else, and the SDK will not
        // exchange the code while it is. That session goes, and the page starts over once.
        if (!restarted.current) {
          // eslint-disable-next-line @silverhand/fp/no-mutation -- the page restarts once, not for ever.
          restarted.current = true;
          await clearAllTokens();
          window.location.reload();
        }

        return;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 250);
      });

      await check(attempt + 1);
    };

    void check(0);

    return () => {
      // eslint-disable-next-line @silverhand/fp/no-mutation -- the page is left, the check must stop.
      left.current = true;
    };
  }, [clearAllTokens, error, getIdTokenClaims, hasCode, onSignedIn]);

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

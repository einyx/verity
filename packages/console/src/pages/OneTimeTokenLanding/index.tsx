import { Prompt, useLogto } from '@logto/react';
import { ExtraParamsKey } from '@logto/schemas';
import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import AppLoading from '@/components/AppLoading';
import useRedirectUri from '@/hooks/use-redirect-uri';
import { saveRedirect } from '@/utils/storage';

enum OneTimeTokenLandingSearchParams {
  OneTimeToken = 'one_time_token',
  Email = 'email',
  Redirect = 'redirect',
}

/** The one-time token landing page for sign-in with one-time tokens. */
function OneTimeTokenLanding() {
  const navigate = useNavigate();
  const { clearAllTokens, isLoading, signIn } = useLogto();
  const [searchParams] = useSearchParams();
  const redirectUri = useRedirectUri();

  const oneTimeToken = searchParams.get(OneTimeTokenLandingSearchParams.OneTimeToken);
  const email = searchParams.get(OneTimeTokenLandingSearchParams.Email);
  const redirectPath = searchParams.get(OneTimeTokenLandingSearchParams.Redirect);

  useEffect(() => {
    if (isLoading) {
      return;
    }

    if (!oneTimeToken || !email) {
      // Navigate to root, which will handle tenant selection
      void navigate('/', { replace: true });
      return;
    }

    // Without a target, the Console root is where the person lands: it opens the tenant they
    // are a member of. Saving this page would send them back here after the sign-in, and the
    // one-time token would already be spent.
    saveRedirect(redirectPath ? new URL(redirectPath) : new URL('/', window.location.origin));

    /**
     * The token names the person to sign in as, so the session in this browser is not theirs. It
     * has to go before the sign-in: the Console only exchanges the code of the callback when the
     * client is not signed in yet, and a signed-in client would leave the callback page waiting
     * for ever.
     *
     * The tokens are cleared first and the sign-in keeps them: clearing them while the sign-in
     * stores its own session would race, and the session is what the code is exchanged with.
     */
    const signInAsTheInvited = async () => {
      await clearAllTokens();
      await signIn({
        redirectUri,
        clearTokens: false,
        prompt: Prompt.Consent,
        extraParams: {
          [ExtraParamsKey.OneTimeToken]: oneTimeToken,
          [ExtraParamsKey.LoginHint]: email,
        },
      });
    };

    void signInAsTheInvited();
  }, [clearAllTokens, isLoading, navigate, signIn, redirectUri, oneTimeToken, email, redirectPath]);

  return <AppLoading />;
}

export default OneTimeTokenLanding;

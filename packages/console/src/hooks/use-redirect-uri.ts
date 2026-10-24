import { ossConsolePath } from '@logto/schemas';
import { conditionalArray, joinPath } from '@silverhand/essentials';
import { useMemo } from 'react';
import { useHref } from 'react-router-dom';

import { isCloud } from '@/consts/env';

/**
 * The hook that returns the absolute URL for the sign-in or sign-out callback.
 * The path is not related to react-router, which means the path will also include
 * the basename of react-router if it's set.
 */
const useRedirectUri = (flow: 'signIn' | 'signOut' = 'signIn') => {
  // Sign-out returns to the console's own sign-in, not the root: on cloud the root is the public landing page.
  // On cloud the router's basename is already the console path, so useHref adds it; repeating it here would
  // produce `/console/console`, which is not a registered post-logout URI.
  const path = useHref(
    flow === 'signIn'
      ? joinPath(...conditionalArray(!isCloud && ossConsolePath), '/callback')
      : joinPath(...conditionalArray(!isCloud && ossConsolePath), '/')
  );
  const url = useMemo(() => new URL(path, window.location.origin), [path]);

  return url;
};

export default useRedirectUri;

import { ossConsolePath } from '@logto/schemas';
import { trySafe } from '@silverhand/essentials';
import { type Path } from 'react-router-dom';
import { z } from 'zod/v3';

import { storageKeys } from '@/consts';
import { isCloud } from '@/consts/env';

/**
 * The router's basename is `/console` on cloud (see `App.tsx`). The saved path must be relative to
 * it, or the router adds the prefix again on return and `/console/admin` becomes tenant `console`.
 */
const toRouterPath = (pathname: string) => {
  if (!isCloud) {
    return pathname;
  }

  if (pathname === ossConsolePath) {
    return '/';
  }

  return pathname.startsWith(`${ossConsolePath}/`)
    ? pathname.slice(ossConsolePath.length)
    : pathname;
};

/** Save the current url to session storage so that we can redirect to it after sign in. */
export const saveRedirect = (target?: URL) => {
  const isValidTarget = target && target.origin === window.location.origin;
  const { pathname, search, hash } = isValidTarget ? target : window.location;
  sessionStorage.setItem(
    storageKeys.redirectAfterSignIn,
    JSON.stringify({ pathname: toRouterPath(pathname), search, hash })
  );
};

const partialPathGuard = z
  .object({
    pathname: z.string(),
    search: z.string(),
    hash: z.string(),
  })
  .partial() satisfies z.ZodType<Partial<Path>>;

/** Get the saved redirect url from session storage and remove it. */
export const consumeSavedRedirect = () => {
  const saved = trySafe(() =>
    partialPathGuard.parse(
      JSON.parse(sessionStorage.getItem(storageKeys.redirectAfterSignIn) ?? '')
    )
  );

  if (saved) {
    sessionStorage.removeItem(storageKeys.redirectAfterSignIn);
  }
  return saved;
};

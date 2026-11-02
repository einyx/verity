import ky from 'ky';
import { createContext, useCallback, useContext, useMemo } from 'react';

export const FixtureActor = createContext('ordinary');
export const TenantsContext = createContext({ currentTenantId: 'a' });
// eslint-disable-next-line import/no-unused-modules -- Re-exported by the owned Vite virtual SDK boundary.
export const useFixtureAuth = () => {
  const actor = useContext(FixtureActor);
  const getIdTokenClaims = useCallback(async () => ({ sub: actor, iat: 1 }), [actor]);
  return { isAuthenticated: true, getIdTokenClaims };
};
// eslint-disable-next-line import/no-unused-modules -- Re-exported by the owned Vite virtual API boundary.
export const useFixtureApi = () => {
  const { currentTenantId } = useContext(TenantsContext);
  const actor = useContext(FixtureActor);
  return useMemo(
    () =>
      ky.create({
        prefixUrl: `${window.location.origin}/__kubo-api/${actor}/${currentTenantId}/`,
        retry: 0,
      }),
    [actor, currentTenantId]
  );
};

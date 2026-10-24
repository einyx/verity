import { Prompt, useLogto } from '@logto/react';
import { adminTenantId, getTenantOrganizationId } from '@logto/schemas';
import { useContext, useEffect, useRef, useState } from 'react';

import { isCloud } from '@/consts/env';
import { TenantsContext } from '@/contexts/TenantsProvider';
import useCurrentTenantScopes from '@/hooks/use-current-tenant-scopes';
import useRedirectUri from '@/hooks/use-redirect-uri';
import { saveRedirect } from '@/utils/storage';

import {
  getTenantScopeChanges,
  shouldRemoveTenantForNoScopes,
  type TenantTokenClaims,
} from './tenant-scope-sync';

/**
 * Listens to the tenant scope changes for the current signed-in user. This hook will fetch the tenant scopes
 * for the user, and compare it with the "scope" token claim in access token. After comparing the scopes:
 *
 * - If the user has been granted new scopes, it will re-consent to obtain the additional scopes.
 * - If the user has been revoked scopes, it will clear the cached access token and renew one with shrunk scopes.
 *
 * Note: This hook should only be used once in the ConsoleContent component.
 */
const useTenantScopeListener = () => {
  const { currentTenantId, removeTenant, navigateTenant } = useContext(TenantsContext);
  const { clearAccessToken, clearAllTokens, getOrganizationTokenClaims, signIn } = useLogto();
  const [tokenClaimsByTenant, setTokenClaimsByTenant] = useState<TenantTokenClaims>({});
  const redirectUri = useRedirectUri();
  const { scopes, isLoading } = useCurrentTenantScopes();
  const previousTenantRef = useRef<string>(currentTenantId);
  const isTenantSwitch = currentTenantId !== previousTenantRef.current;

  useEffect(() => {
    // eslint-disable-next-line @silverhand/fp/no-mutation -- Track tenant changes between renders.
    previousTenantRef.current = currentTenantId;
  }, [currentTenantId]);

  useEffect(() => {
    // The claims only feed the Cloud scope sync below. In OSS, requesting a tenant organization
    // token would fail once the organization requires MFA the user has not set up, and end the
    // session.
    // The admin tenant is reached with its Management API token, so its organization token scopes
    // are not compared. An empty organization scope there would force a re-consent sign-in.
    if (!isCloud || currentTenantId === adminTenantId) {
      return;
    }

    (async () => {
      const organizationId = getTenantOrganizationId(currentTenantId);
      const claims = await getOrganizationTokenClaims(organizationId);
      setTokenClaimsByTenant((tokenClaims) => ({
        ...tokenClaims,
        [currentTenantId]: claims?.scope?.split(' ') ?? [],
      }));
    })();
  }, [currentTenantId, getOrganizationTokenClaims]);

  useEffect(() => {
    if (
      shouldRemoveTenantForNoScopes({
        isCloud,
        isLoading,
        isAdminTenant: currentTenantId === adminTenantId,
        isTenantSwitch,
        scopes,
      })
    ) {
      // Skip the "no access" removal on tenant switch. The scopes fetch for the *new*
      // tenant may briefly report [] while SWR transitions or for the very first load
      // of a tenant the user has access to. Only act on sustained no-access while
      // staying on the same tenant.
      if (isTenantSwitch) {
        return;
      }
      // User has no access to the current tenant. Navigate to root and it will return to the
      // last visited tenant, or fallback to the page where the user can create a new tenant.
      removeTenant(currentTenantId);
      navigateTenant('');
    }
  }, [currentTenantId, isLoading, isTenantSwitch, navigateTenant, removeTenant, scopes]);

  useEffect(() => {
    if (!isCloud || isLoading) {
      return;
    }
    const scopeChanges = getTenantScopeChanges(currentTenantId, scopes, tokenClaimsByTenant);
    if (!scopeChanges) {
      return;
    }
    const { hasScopesGranted, hasScopesRevoked } = scopeChanges;

    // Skip re-consent on tenant switch. A fresh organization token is fetched for the new tenant.
    // Only re-consent for scope grants that happen *while staying on the same tenant*.
    if (hasScopesGranted && !isTenantSwitch) {
      (async () => {
        // User has been newly granted scopes. Need to re-consent to obtain the additional scopes.
        saveRedirect();
        await clearAllTokens();
        void signIn({
          redirectUri: redirectUri.href,
          prompt: Prompt.Consent,
        });
      })();
    }
    if (hasScopesRevoked) {
      // User has been revoked scopes. Need to clear the cached access token and it will be renewed
      // automatically with shrunk scopes.
      void clearAccessToken();
    }
  }, [
    clearAccessToken,
    clearAllTokens,
    currentTenantId,
    isLoading,
    isTenantSwitch,
    redirectUri.href,
    scopes,
    signIn,
    tokenClaimsByTenant,
  ]);
};

export default useTenantScopeListener;

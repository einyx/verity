export type TenantTokenClaims = Record<string, string[]>;

export const getTenantScopeChanges = (
  currentTenantId: string,
  scopes: string[] | undefined,
  tokenClaimsByTenant: TenantTokenClaims
) => {
  const tokenClaims = tokenClaimsByTenant[currentTenantId];
  if (!tokenClaims) {
    return;
  }

  return {
    hasScopesGranted: scopes?.some((scope) => !tokenClaims.includes(scope)) ?? false,
    hasScopesRevoked: tokenClaims.some((claim) => !scopes?.includes(claim)),
  };
};

export const shouldRemoveTenantForNoScopes = ({
  isCloud,
  isLoading,
  isAdminTenant,
  isTenantSwitch,
  scopes,
}: {
  isCloud: boolean;
  isLoading: boolean;
  isAdminTenant: boolean;
  isTenantSwitch: boolean;
  scopes: string[] | undefined;
}) => isCloud && !isLoading && !isAdminTenant && !isTenantSwitch && scopes?.length === 0;

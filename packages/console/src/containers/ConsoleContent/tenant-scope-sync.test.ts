import { getTenantScopeChanges, shouldRemoveTenantForNoScopes } from './tenant-scope-sync';

describe('getTenantScopeChanges', () => {
  it('ignores claims cached for a different tenant', () => {
    expect(
      getTenantScopeChanges('admin', ['admin:read'], {
        customer: ['customer:read'],
      })
    ).toBeUndefined();
  });

  it('compares scopes when claims belong to the current tenant', () => {
    expect(
      getTenantScopeChanges('customer', ['customer:read', 'customer:write'], {
        customer: ['customer:read'],
      })
    ).toEqual({ hasScopesGranted: true, hasScopesRevoked: false });
  });
});

describe('shouldRemoveTenantForNoScopes', () => {
  const defaults = {
    isCloud: true,
    isLoading: false,
    isAdminTenant: false,
    isTenantSwitch: false,
    scopes: [],
  };

  it('keeps the Admin tenant even when it has no member scopes', () => {
    expect(shouldRemoveTenantForNoScopes({ ...defaults, isAdminTenant: true })).toBe(false);
  });

  it('removes a customer tenant with no scopes after loading', () => {
    expect(shouldRemoveTenantForNoScopes(defaults)).toBe(true);
  });
});

/**
 * The subset of a tenant the usage meter reads. It is declared here so the route does not import the
 * tenant modules, which import the tenant app that mounts the route.
 */
type UsageTenant = {
  subscription: {
    getTenantTokenUsage: (range: { from: Date; to: Date }) => Promise<{
      totalUsage: number;
      userTokenUsage: number;
      m2mTokenUsage: number;
    }>;
  };
  queries: {
    dailyActiveUsers: {
      countActiveUsersByTimeInterval: (from: number, to: number) => Promise<{ count: number }>;
    };
  };
};

const lookups = new Map<'tenant', (tenantId: string) => Promise<UsageTenant>>();

/** Registers how the usage meter loads a tenant. The tenant pool registers itself at startup. */
export const registerTenantLookup = (lookup: (tenantId: string) => Promise<UsageTenant>) => {
  lookups.set('tenant', lookup);
};

/** Loads a tenant for the usage meter. Throws if no lookup is registered yet. */
export const getTenantForUsage = async (tenantId: string): Promise<UsageTenant> => {
  const lookup = lookups.get('tenant');

  if (!lookup) {
    throw new Error('The tenant lookup for usage is not registered.');
  }

  return lookup(tenantId);
};

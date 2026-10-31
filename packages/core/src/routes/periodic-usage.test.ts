import { createMockUtils } from '@logto/shared/esm';
import type { Context } from 'koa';

import type { EnvSet } from '#src/env-set/index.js';

const { jest } = import.meta;
const { mockEsm } = createMockUtils(jest);

const createPool = jest.fn(async () => ({}));
const findMembership = jest.fn<Promise<string | undefined>, unknown[]>();
const findSubscription = jest.fn();
const store = { findMembership, findSubscription };
const createPgBillingStore = jest.fn(() => store);
const verifyBearerTokenFromRequest = jest.fn(async () => ({ sub: 'user-1' }));
const getTenantTokenUsage = jest.fn(async () => ({
  totalUsage: 10,
  userTokenUsage: 7,
  m2mTokenUsage: 3,
}));
const countActiveUsersByTimeInterval = jest.fn(async () => ({ count: 2 }));
const getTenantForUsage = jest.fn(async () => ({
  subscription: { getTenantTokenUsage },
  queries: { dailyActiveUsers: { countActiveUsersByTimeInterval } },
}));

mockEsm('@silverhand/slonik', () => ({ createPool }));
mockEsm('#src/cloud-plugin/index.js', () => ({
  loadCloudPlugin: async () => ({ createPgBillingStore }),
}));
mockEsm('#src/middleware/koa-auth/index.js', () => ({ verifyBearerTokenFromRequest }));
mockEsm('#src/tenants/tenant-lookup.js', () => ({ getTenantForUsage }));
mockEsm('#src/env-set/index.js', () => ({
  EnvSet: {
    values: {
      adminUrlSet: { endpoint: new URL('https://admin.example.com') },
      cloudUrlSet: { endpoint: new URL('https://cloud.example.com') },
    },
  },
}));

const { periodicUsageRoute } = await import('./periodic-usage.js');

// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Authentication is mocked, so the route never reads this instance.
const envSet = {} as EnvSet;
const createContext = (
  method = 'GET',
  path = '/api/tenants/tenant-1/subscription/periodic-usage'
) =>
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Only the middleware's consumed context fields are needed; authentication is mocked.
  ({ method, path, request: {} }) as Context;

beforeEach(() => {
  jest.clearAllMocks();
  createPool.mockReset().mockResolvedValue({});
  findMembership.mockReset().mockResolvedValue('admin');
  verifyBearerTokenFromRequest.mockReset().mockResolvedValue({ sub: 'user-1' });
});

it('does not initialize the billing pool when constructing the middleware', async () => {
  periodicUsageRoute(envSet);
  await Promise.resolve();

  expect(createPool).toHaveBeenCalledTimes(0);
  expect(createPgBillingStore).toHaveBeenCalledTimes(0);
});

it.each([
  ['GET', '/api/other'],
  ['POST', '/api/tenants/tenant-1/subscription/periodic-usage'],
])('does not initialize billing for nonmatching %s %s requests', async (method, path) => {
  const route = periodicUsageRoute(envSet);
  const next = jest.fn();
  await route(createContext(method, path), next);

  expect(next).toHaveBeenCalledTimes(1);
  expect(verifyBearerTokenFromRequest).toHaveBeenCalledTimes(0);
  expect(createPool).toHaveBeenCalledTimes(0);
  expect(createPgBillingStore).toHaveBeenCalledTimes(0);
});

it('does not initialize billing when bearer verification rejects', async () => {
  const failure = new Error('Unauthorized');
  verifyBearerTokenFromRequest.mockRejectedValueOnce(failure);
  const route = periodicUsageRoute(envSet);

  await expect(route(createContext(), jest.fn())).rejects.toBe(failure);
  expect(createPool).toHaveBeenCalledTimes(0);
  expect(createPgBillingStore).toHaveBeenCalledTimes(0);
  expect(findMembership).toHaveBeenCalledTimes(0);
});

it('initializes once after verification and reuses billing for concurrent and later requests', async () => {
  verifyBearerTokenFromRequest.mockImplementationOnce(async () => {
    expect(createPool).toHaveBeenCalledTimes(0);
    return { sub: 'user-1' };
  });
  const route = periodicUsageRoute(envSet);
  const contexts = [createContext(), createContext()];
  await Promise.all(contexts.map(async (ctx) => route(ctx, jest.fn())));
  const laterContext = createContext();
  await route(laterContext, jest.fn());

  expect(createPool).toHaveBeenCalledTimes(1);
  expect(createPgBillingStore).toHaveBeenCalledTimes(1);
  expect(findMembership).toHaveBeenCalledTimes(3);
  expect(findMembership).toHaveBeenCalledWith('tenant-1', {
    issuer: 'https://admin.example.com/oidc',
    sub: 'user-1',
  });
  for (const ctx of [...contexts, laterContext]) {
    expect(ctx.body).toEqual({
      mauLimit: 2,
      tokenLimit: 10,
      userTokenLimit: 7,
      m2mTokenLimit: 3,
    });
  }
});

it.each([undefined, 'member'])(
  'preserves the not-found response for membership %s',
  async (role) => {
    findMembership.mockResolvedValueOnce(role);
    const route = periodicUsageRoute(envSet);
    const ctx = createContext();
    await route(ctx, jest.fn());

    expect(ctx.status).toBe(404);
    expect(ctx.body).toEqual({ code: 'tenant.not_found', message: 'Tenant not found.' });
    expect(findSubscription).toHaveBeenCalledTimes(0);
    expect(getTenantForUsage).toHaveBeenCalledTimes(0);
  }
);

it('awaits pool initialization failures in the requesting middleware invocation', async () => {
  const route = periodicUsageRoute(envSet);
  const failure = new Error('Billing database unavailable');
  // Install the failure after construction: no rejected startup promise can escape this test.
  createPool.mockRejectedValueOnce(failure);

  await expect(route(createContext(), jest.fn())).rejects.toBe(failure);
  expect(createPool).toHaveBeenCalledTimes(1);
  expect(createPgBillingStore).toHaveBeenCalledTimes(0);
  expect(findMembership).toHaveBeenCalledTimes(0);
});

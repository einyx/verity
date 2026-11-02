import { createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify, SignJWT } from 'jose';

const { jest } = import.meta;
const issuer = 'https://console.invalid/oidc';
const audience = 'https://console.invalid/api';
const first = await generateKeyPair('ES256');
const second = await generateKeyPair('ES256');
const publicKey = async (key: CryptoKey, kid: string) => ({ ...(await exportJWK(key)), kid });
const firstJwk = await publicKey(first.publicKey, 'first');
const secondJwk = await publicKey(second.publicKey, 'second');
const resolver = { current: createLocalJWKSet({ keys: [firstJwk] }) };
const requestEnd = jest.fn();
const getTenant = jest.fn(async () => ({
  envSet: { oidc: { localJWKSet: resolver.current } },
  requestEnd,
}));
const { registerAdminKeyProvider } = await import('#src/tenants/admin-key-resolver.js');
registerAdminKeyProvider(getTenant);
jest.unstable_mockModule('#src/env-set/index.js', () => ({
  EnvSet: { values: { adminUrlSet: { endpoint: new URL('https://console.invalid') } } },
}));
jest.unstable_mockModule('@silverhand/slonik', () => ({ createPool: async () => ({}) }));
jest.unstable_mockModule('./cloud-console-host.js', () => ({ createCloudConsoleHost: () => ({}) }));
const createComposer = jest.fn((config) => config);
const complete = jest.fn().mockResolvedValue('complete');
const migrate = jest.fn().mockResolvedValue('complete');
jest.unstable_mockModule('#src/cloud-plugin/index.js', () => ({
  isCloudPluginInstalled: () => true,
  loadCloudPlugin: async () => ({
    createBillingComposer: createComposer,
    createBillingHandler: () => complete,
    createPgBillingStore: () => ({}),
    migrateBillingSchema: migrate,
  }),
}));
const { billingRoutes } = await import('./billing.js');

it('verifies with only the trusted local admin provider and sees rotated keys', async () => {
  const original = { ...process.env };
  process.env = {
    ...process.env,
    BILLING_DATABASE_URL: 'postgresql://test.invalid/db',
    STRIPE_SECRET_KEY: 'sk_test_synthetic',
    STRIPE_WEBHOOK_SECRET: 'whsec_synthetic',
    STRIPE_PRO_PRICE_ID: 'price_synthetic',
  };
  try {
    const middleware = billingRoutes();
    await middleware(
      { path: '/api/skus', req: {}, res: { setHeader: jest.fn() } } as never,
      complete
    );
    const config = createComposer.mock.calls[0]?.[0] as {
      auth: { getKey: Parameters<typeof jwtVerify>[1] };
    };
    const token = async (privateKey: CryptoKey, kid: string) =>
      new SignJWT({ sub: 'synthetic-user' })
        .setProtectedHeader({ alg: 'ES256', kid })
        .setIssuer(issuer)
        .setAudience(audience)
        .setExpirationTime('5m')
        .sign(privateKey);
    await expect(
      jwtVerify(await token(first.privateKey, 'first'), config.auth.getKey, { issuer, audience })
    ).resolves.toBeDefined();
    // eslint-disable-next-line @silverhand/fp/no-mutation -- Simulate provider reload after key rotation.
    resolver.current = createLocalJWKSet({ keys: [firstJwk, secondJwk] });
    await expect(
      jwtVerify(await token(second.privateKey, 'second'), config.auth.getKey, { issuer, audience })
    ).resolves.toBeDefined();
    expect(getTenant).toHaveBeenCalledWith('admin');
    expect(requestEnd).toHaveBeenCalledTimes(2);
  } finally {
    process.env = original;
  }
});

it('returns a sanitized 503 for initialization failure without an unhandled rejection', async () => {
  const original = { ...process.env };
  process.env = {
    ...process.env,
    BILLING_DATABASE_URL: 'postgresql://test.invalid/db',
    STRIPE_SECRET_KEY: 'sk_test_synthetic',
    STRIPE_WEBHOOK_SECRET: 'whsec_synthetic',
    STRIPE_PRO_PRICE_ID: 'price_synthetic',
  };
  migrate.mockRejectedValueOnce(new Error('synthetic private infrastructure detail'));
  const context: Record<string, unknown> = {
    path: '/api/skus',
    requestId: 'synthetic-correlation',
    req: {},
    res: { setHeader: jest.fn() },
  };
  try {
    const middleware = billingRoutes();
    await expect(middleware(context as never, complete)).resolves.toBeUndefined();
    expect(context.status).toBe(503);
    expect(context.body).toEqual({ code: 'billing_service_unavailable' });
  } finally {
    process.env = original;
  }
});

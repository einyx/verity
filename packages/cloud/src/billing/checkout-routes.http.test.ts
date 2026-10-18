/* eslint-disable @silverhand/fp/no-let, @silverhand/fp/no-mutation -- The server and its base URL are created once in beforeAll and torn down in afterAll, so the test needs them reassigned. */
import createServer, { compose, withBody, withRequest } from '@withtyped/server';
import { generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type OperatorAuthConfig } from './auth.js';
import { type CheckoutConfig } from './checkout.js';
import { createBillingRouter } from './router.js';
import { createInMemoryBillingStore } from './store.js';

const issuer = 'https://auth.example.test/oidc';
const audience = 'https://billing.example.test';
const tenantAdminSub = 'tenant-admin-user-1';
const strangerSub = 'stranger-user-1';
const tenantId = 'tenant0000000000002';
const callbackOrigin = 'https://console.logto.app';

const checkoutConfig: CheckoutConfig = {
  stripeSecretKey: 'sk_test_unused_in_these_tests',
  priceIdBySkuId: { pro: 'price_pro' },
  returnOrigins: [callbackOrigin],
};

const body = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    tenantId,
    skuId: 'pro',
    successCallbackUrl: `${callbackOrigin}/checkout-success`,
    ...overrides,
  });

describe('checkout routes over HTTP', () => {
  let privateKey: CryptoKey;
  let publicKey: CryptoKey;
  let baseUrl = '';
  let close: (() => Promise<void>) | undefined;

  const auth = (): OperatorAuthConfig => ({
    issuer,
    audience,
    getKey: async () => publicKey,
    operators: [],
  });

  const tokenFor = async (sub: string) =>
    new SignJWT({})
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);

  const post = async (payload: string, sub?: string) =>
    fetch(`${baseUrl}/api/checkout-session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(sub ? { authorization: `Bearer ${await tokenFor(sub)}` } : {}),
      },
      body: payload,
    });

  beforeAll(async () => {
    const pair = await generateKeyPair('ES256');
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;

    const store = createInMemoryBillingStore({
      members: { [tenantId]: [{ issuer, sub: tenantAdminSub, role: 'admin' }] },
    });
    const router = createBillingRouter(store, auth(), checkoutConfig);

    const port = 19_432;
    const server = createServer({
      port,
      logLevel: 'none',
      composer: compose(withRequest()).and(withBody()).and(router.routes()),
    });

    baseUrl = `http://127.0.0.1:${port}`;
    await server.listen();
    close = server.close;
  });

  afterAll(async () => {
    await close?.();
  });

  it('returns 401 when no token is sent', async () => {
    const response = await post(body());

    expect(response.status).toBe(401);
  });

  it('returns 403 to a caller who is not an admin of the tenant', async () => {
    const response = await post(body(), strangerSub);

    expect(response.status).toBe(403);
  });

  it('returns 400 for a plan that has no Stripe price', async () => {
    const response = await post(body({ skuId: 'enterprise' }), tenantAdminSub);

    expect(response.status).toBe(400);
  });

  it('returns 400 for a return URL outside the allowed origins', async () => {
    const response = await post(
      body({ successCallbackUrl: 'https://evil.example/checkout-success' }),
      tenantAdminSub
    );

    expect(response.status).toBe(400);
  });

  it('returns 400 for a return URL that only starts with an allowed origin', async () => {
    const response = await post(
      body({ successCallbackUrl: `${callbackOrigin}.evil.example/cb` }),
      tenantAdminSub
    );

    expect(response.status).toBe(400);
  });
});

/* eslint-enable @silverhand/fp/no-let, @silverhand/fp/no-mutation */

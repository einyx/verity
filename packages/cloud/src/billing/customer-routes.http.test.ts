/* eslint-disable @silverhand/fp/no-let, @silverhand/fp/no-mutation -- The server and its base URL are created once in beforeAll and torn down in afterAll, so the test needs them reassigned. */
import createServer, { compose, withBody, withRequest } from '@withtyped/server';
import { generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type OperatorAuthConfig } from './auth.js';
import { createCustomerRouter } from './customer-router.js';
import { createInMemoryBillingStore } from './store.js';

const issuer = 'https://auth.example.test/oidc';
const audience = 'https://billing.example.test';
const strangerSub = 'stranger-user-1';
const enterpriseId = 'tenant0000000000003';

describe('enterprise portal route over HTTP', () => {
  let privateKey: CryptoKey;
  let publicKey: CryptoKey;
  let baseUrl = '';
  // Assigned in beforeAll and cleared in afterAll, so it cannot be a const.
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

  const post = async (sub?: string) =>
    fetch(`${baseUrl}/api/me/logto-enterprises/${enterpriseId}/stripe-customer-portal`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(sub ? { authorization: `Bearer ${await tokenFor(sub)}` } : {}),
      },
      body: JSON.stringify({ callbackUrl: 'https://console.logto.app/tenant-settings' }),
    });

  beforeAll(async () => {
    const pair = await generateKeyPair('ES256');
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;

    const router = createCustomerRouter(createInMemoryBillingStore(), auth(), {
      stripeSecretKey: 'sk_test_unused',
      priceIdBySkuId: { pro: 'price_pro' },
      returnOrigins: ['https://console.logto.app'],
    });
    const port = 19_435;
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
    const response = await post();

    expect(response.status).toBe(401);
  });

  it('returns 404 to a caller who does not administer the enterprise account', async () => {
    const response = await post(strangerSub);

    expect(response.status).toBe(404);
  });
});

/* eslint-enable @silverhand/fp/no-let, @silverhand/fp/no-mutation */

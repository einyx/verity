import { createHmac } from 'node:crypto';

import createServer from '@withtyped/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type OperatorAuthConfig } from './billing/auth.js';
import { createInMemoryBillingStore } from './billing/store.js';
import { createBillingComposer, stripeWebhookPath } from './billing-server.js';

const secret = 'whsec_test_server';
const port = 19_434;

const auth: OperatorAuthConfig = {
  issuer: 'https://auth.example.test/oidc',
  audience: 'https://billing.example.test',
  getKey: async () => {
    throw new Error('not used: these tests never send a bearer token');
  },
  operators: [],
};

const invoicePaid = JSON.stringify({
  id: 'evt_server_1',
  type: 'invoice.paid',
  data: { object: {} },
});

const sign = (payload: string) => {
  const timestamp = Math.floor(Date.now() / 1000);

  return `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')}`;
};

describe('billing server composition', () => {
  const composer = createBillingComposer({
    store: createInMemoryBillingStore(),
    auth,
    checkout: {
      stripeSecretKey: 'sk_test_unused',
      priceIdBySkuId: { pro: 'price_pro' },
      returnOrigins: ['https://console.example.test'],
    },
    stripeSecretKey: 'sk_test_unused',
    stripeWebhookSecret: secret,
  });
  const server = createServer({ port, logLevel: 'none', composer });
  const baseUrl = `http://127.0.0.1:${port}`;

  beforeAll(async () => {
    await server.listen();
  });

  afterAll(async () => {
    await server.close();
  });

  it('answers 401 to a webhook with a bad signature', async () => {
    const response = await fetch(`${baseUrl}${stripeWebhookPath}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=00' },
      body: invoicePaid,
    });

    expect(response.status).toBe(401);
  });

  it('answers 200 to a validly signed event the server does not act on', async () => {
    const response = await fetch(`${baseUrl}${stripeWebhookPath}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': sign(invoicePaid) },
      body: invoicePaid,
    });

    expect(response.status).toBe(200);
  });

  it('still routes other paths to the billing API', async () => {
    const response = await fetch(`${baseUrl}/api/tenants/tenant_x/subscription`);

    expect(response.status).toBe(401);
  });
});

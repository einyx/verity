/* eslint-disable @silverhand/fp/no-let, @silverhand/fp/no-mutation, @silverhand/fp/no-delete -- The server lifecycle and the stubbed global fetch / env var are set up and torn down per suite, so they need reassignment and delete. */
import type { Server } from 'node:http';

import Koa from 'koa';
import request from 'supertest';

const { jest } = import.meta;

const envValues = { isCloud: true, isProduction: false };

// The local checkout marks the tenant as production in the database, so the mocked environment
// needs a pool that accepts the update.
const sharedPool = { query: jest.fn().mockResolvedValue([]) };

jest.unstable_mockModule('#src/env-set/index.js', () => ({
  EnvSet: { values: envValues, sharedPool: Promise.resolve(sharedPool) },
  getTenantEndpoint: jest.fn(),
  getTenantLocalhost: jest.fn(),
}));

const { localCloudRoutes } = await import('./cloud-dev.js');

// The server listens on a real port so the request origin is the address the test uses. Overriding
// the Host header would not do that, because the HTTP client sets it from the socket address.
let server: Server;
let origin: string;

beforeAll(async () => {
  const app = new Koa();
  app.use(localCloudRoutes());
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => {
    server.once('listening', () => {
      resolve();
    });
  });
  const { port } = server.address() as { port: number };
  origin = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
});

const originalFetch = global.fetch;
const originalStripeKey = process.env.STRIPE_SECRET_KEY;

afterEach(() => {
  global.fetch = originalFetch;

  if (originalStripeKey === undefined) {
    delete process.env.STRIPE_SECRET_KEY;
  } else {
    process.env.STRIPE_SECRET_KEY = originalStripeKey;
  }
});

const checkout = (body: Record<string, unknown>) =>
  request(server).post('/api/checkout-session').send(body);

const stripeSession = (metadata: Record<string, string>) => ({
  id: 'cs_test_1',
  status: 'complete',
  payment_status: 'paid',
  metadata,
});

const pollStatus = (session: unknown) => {
  global.fetch = jest.fn(async () => ({ json: async () => session })) as unknown as typeof fetch;

  return request(server).get('/api/checkout-session/cs_test_1');
};

describe('local cloud checkout', () => {
  beforeEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
  });

  it('refuses a checkout for a tenant other than the current one', async () => {
    const response = await checkout({
      tenantId: 'other-tenant',
      successCallbackUrl: `${origin}/cb`,
    });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('checkout.tenant_mismatch');
  });

  it.each([
    ['another host', 'http://evil.example/cb'],
    ['a host that starts with this origin', 'http://127.0.0.1.evil.example/cb'],
    ['a different port', 'http://127.0.0.1:1/cb'],
    ['a different scheme', 'https://127.0.0.1/cb'],
    ['an unparsable URL', 'not a url'],
    ['a missing URL', undefined],
  ])('refuses a success callback on %s', async (_, successCallbackUrl) => {
    const response = await checkout({ successCallbackUrl });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('checkout.invalid_callback_url');
  });

  it('accepts a success callback on this origin', async () => {
    const response = await checkout({ successCallbackUrl: `${origin}/cb` });

    expect(response.status).toBe(200);
    expect(response.body.redirectUri).toBe(`${origin}/cb`);
  });
});

describe('checkout status with Stripe', () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_example';
  });

  it('reports complete for a paid session created for the current tenant', async () => {
    const response = await pollStatus(stripeSession({ tenantId: 'default', skuId: 'pro' }));

    expect(response.body.status).toBe('complete');
    expect(response.body.tenantId).toBe('default');
  });

  it('does not report complete for a paid session created for another tenant', async () => {
    const response = await pollStatus(stripeSession({ tenantId: 'other-tenant', skuId: 'pro' }));

    expect(response.body.status).toBe('open');
    expect(response.body.tenantId).toBe('other-tenant');
  });
});

/* eslint-enable @silverhand/fp/no-let, @silverhand/fp/no-mutation, @silverhand/fp/no-delete */

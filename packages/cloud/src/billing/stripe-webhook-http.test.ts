import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import { skuGuard } from './sku.js';
import { createInMemoryBillingStore, type BillingStore } from './store.js';
import { createStripeWebhookHandler } from './stripe-webhook-http.js';

const secret = 'whsec_test';
const nowSeconds = 1_800_000_000;

// The subscription quota must be complete, so the fixture lists every field.
const proSku = skuGuard.parse({
  type: 'Basic',
  id: 'pro',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  name: 'Pro',
  defaultPriceId: null,
  unitPrice: null,
  quota: {
    mauLimit: 50_000,
    applicationsLimit: 3,
    thirdPartyApplicationsLimit: 0,
    scopesPerResourceLimit: 1,
    socialConnectorsLimit: 3,
    userRolesLimit: 1,
    machineToMachineRolesLimit: 1,
    scopesPerRoleLimit: 1,
    hooksLimit: 1,
    auditLogsRetentionDays: 3,
    customJwtEnabled: false,
    actionsEnabled: false,
    subjectTokenEnabled: false,
    bringYourUiEnabled: false,
    collectUserProfileEnabled: false,
    passkeySignInEnabled: false,
    tokenLimit: 500_000,
    hostedEmailLimit: 100_000,
    hostedEmailDailyLimit: 10_000,
    machineToMachineLimit: 1,
    resourcesLimit: 1,
    enterpriseSsoLimit: 0,
    consoleSsoConnectorLimit: 0,
    tenantMembersLimit: 1,
    mfaEnabled: false,
    organizationsEnabled: false,
    organizationsLimit: 0,
    idpInitiatedSsoEnabled: false,
    samlApplicationsLimit: 0,
    securityFeaturesEnabled: false,
    customDomainsLimit: 1,
  },
});

const payload = JSON.stringify({
  id: 'evt_http_1',
  type: 'checkout.session.completed',
  data: {
    object: {
      status: 'complete',
      payment_status: 'paid',
      customer: 'cus_1',
      subscription: 'sub_1',
      metadata: { tenantId: 'tenant_a', skuId: 'pro' },
    },
  },
});

const signed = (body: string) =>
  `t=${nowSeconds},v1=${createHmac('sha256', secret).update(`${nowSeconds}.${body}`).digest('hex')}`;

/** Starts the handler on a free local port. The caller closes it when the test ends. */
const startServer = async (store: BillingStore) => {
  const handler = createStripeWebhookHandler({
    secret,
    store,
    now: () => nowSeconds * 1000,
    retrieveSubscription: async () => ({
      id: 'sub_1',
      status: 'active',
      current_period_start: 1_801_000_000,
      current_period_end: 1_803_600_000,
    }),
  });
  const server = createServer((request, response) => {
    void handler(request, response);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });

  const { port } = server.address() as { port: number };

  return {
    url: `http://127.0.0.1:${port}/api/webhooks/stripe`,
    close: async () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
};

const post = async (url: string, body: string, signature?: string) =>
  fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(signature ? { 'stripe-signature': signature } : {}),
    },
    body,
  });

describe('createStripeWebhookHandler over HTTP', () => {
  it('applies a signed paid checkout and answers 200', async () => {
    const store = createInMemoryBillingStore({ skus: [proSku] });
    const server = await startServer(store);

    const response = await post(server.url, payload, signed(payload));
    const subscription = await store.findSubscription('tenant_a');
    await server.close();

    expect(response.status).toBe(200);
    expect(subscription?.planId).toBe('pro');
  });

  it('answers 401 for a missing signature and changes nothing', async () => {
    const store = createInMemoryBillingStore({ skus: [proSku] });
    const server = await startServer(store);

    const response = await post(server.url, payload);
    const subscription = await store.findSubscription('tenant_a');
    await server.close();

    expect(response.status).toBe(401);
    expect(subscription).toBeNull();
  });

  it('answers 500 when applying the event fails, so Stripe retries', async () => {
    const store = createInMemoryBillingStore({ skus: [proSku] });
    const failing: BillingStore = {
      ...store,
      activateStripeSubscription: vi.fn(async () => {
        throw new Error('database unavailable');
      }),
    };
    const server = await startServer(failing);

    const response = await post(server.url, payload, signed(payload));
    await server.close();

    expect(response.status).toBe(500);
  });
});

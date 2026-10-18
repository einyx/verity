import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { skuGuard } from './sku.js';
import { createInMemoryBillingStore, type BillingStore } from './store.js';
import { processStripeWebhook, verifyStripeSignature } from './stripe-webhook.js';

const secret = 'whsec_test';
const nowSeconds = 1_800_000_000;

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

const newStore = () => createInMemoryBillingStore({ skus: [proSku] });

const sign = (payload: string, timestamp = nowSeconds, key = secret) =>
  `t=${timestamp},v1=${createHmac('sha256', key).update(`${timestamp}.${payload}`).digest('hex')}`;

const checkoutEvent = (
  overrides: { id?: string; payment_status?: string; metadata?: unknown; skuId?: string } = {}
) =>
  JSON.stringify({
    id: overrides.id ?? 'evt_1',
    type: 'checkout.session.completed',
    data: {
      object: {
        status: 'complete',
        payment_status: overrides.payment_status ?? 'paid',
        customer: 'cus_1',
        subscription: 'sub_1',
        metadata: overrides.metadata ?? { tenantId: 'tenant_a', skuId: overrides.skuId ?? 'pro' },
      },
    },
  });

const deliver = async (store: BillingStore, payload: string, signature = sign(payload)) =>
  processStripeWebhook({ payload, signature, secret, store, nowSeconds });

describe('verifyStripeSignature', () => {
  const payload = checkoutEvent();

  it('accepts a signature made with the endpoint secret', () => {
    expect(verifyStripeSignature({ payload, header: sign(payload), secret, nowSeconds })).toBe(
      true
    );
  });

  it('rejects a payload that changed after signing', () => {
    expect(
      verifyStripeSignature({
        payload: payload.replace('pro', 'enterprise'),
        header: sign(payload),
        secret,
        nowSeconds,
      })
    ).toBe(false);
  });

  it('rejects a signature made with another secret', () => {
    const header = sign(payload, nowSeconds, 'whsec_other');

    expect(verifyStripeSignature({ payload, header, secret, nowSeconds })).toBe(false);
  });

  it('rejects a timestamp outside the tolerance', () => {
    expect(
      verifyStripeSignature({
        payload,
        header: sign(payload, nowSeconds - 301),
        secret,
        nowSeconds,
      })
    ).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(verifyStripeSignature({ payload, header: undefined, secret, nowSeconds })).toBe(false);
  });
});

const subscriptionEvent = (type: string, status: string, id = 'evt_sub') =>
  JSON.stringify({
    id,
    type,
    data: {
      object: {
        id: 'sub_1',
        status,
        current_period_start: 1_801_000_000,
        current_period_end: 1_803_600_000,
      },
    },
  });

describe('processStripeWebhook', () => {
  it('follows Stripe when a paid subscription changes status and period', async () => {
    const store = newStore();
    await deliver(store, checkoutEvent());

    const result = await deliver(
      store,
      subscriptionEvent('customer.subscription.updated', 'past_due'),
      sign(subscriptionEvent('customer.subscription.updated', 'past_due'))
    );
    const subscription = await store.findSubscription('tenant_a');

    expect(result.status).toBe(200);
    expect(subscription?.status).toBe('past_due');
    expect(subscription?.currentPeriodEnd).toBe(new Date(1_803_600_000 * 1000).toISOString());
  });

  it('marks the subscription canceled when Stripe deletes it', async () => {
    const store = newStore();
    await deliver(store, checkoutEvent());
    const payload = subscriptionEvent('customer.subscription.deleted', 'canceled', 'evt_del');

    const result = await deliver(store, payload);

    expect(result.message).toBe('Subscription canceled.');
    const subscription = await store.findSubscription('tenant_a');

    expect(subscription?.status).toBe('canceled');
  });

  it('ignores a subscription update for a subscription it has not activated', async () => {
    const store = newStore();
    const payload = subscriptionEvent('customer.subscription.updated', 'active', 'evt_other');

    const result = await deliver(store, payload);

    expect(result.status).toBe(200);
    expect(await store.findSubscription('tenant_a')).toBeNull();
  });

  it('refuses a subscription event with an unknown status', async () => {
    const store = newStore();
    const payload = subscriptionEvent('customer.subscription.updated', 'bogus', 'evt_bad');

    const result = await deliver(store, payload);

    expect(result.status).toBe(400);
  });

  it('activates the tenant subscription from a paid checkout', async () => {
    const store = newStore();

    const result = await deliver(store, checkoutEvent());
    const subscription = await store.findSubscription('tenant_a');

    expect(result.status).toBe(200);
    expect(subscription?.planId).toBe('pro');
    expect(subscription?.status).toBe('active');
    expect(subscription?.hasBillingCustomer).toBe(true);
    expect(subscription?.quota.mauLimit).toBe(50_000);
  });

  it('does not apply a redelivered event twice', async () => {
    const store = newStore();
    const payload = checkoutEvent();

    await deliver(store, payload);
    const second = await deliver(store, payload);

    expect(second).toEqual({ status: 200, message: 'Event already processed.' });
  });

  it('does not activate an unpaid checkout', async () => {
    const store = newStore();

    const result = await deliver(store, checkoutEvent({ payment_status: 'unpaid' }));

    expect(result.status).toBe(200);
    expect(await store.findSubscription('tenant_a')).toBeNull();
  });

  it('ignores event types it does not handle', async () => {
    const store = newStore();
    const payload = JSON.stringify({ id: 'evt_2', type: 'invoice.paid', data: { object: {} } });

    const result = await deliver(store, payload);

    expect(result.status).toBe(200);
    expect(await store.findSubscription('tenant_a')).toBeNull();
  });

  it('refuses an event with a bad signature', async () => {
    const store = newStore();

    const result = await deliver(store, checkoutEvent(), 't=1,v1=00');

    expect(result.status).toBe(401);
    expect(await store.findSubscription('tenant_a')).toBeNull();
  });

  it('refuses a checkout without the tenant metadata', async () => {
    const store = newStore();

    const result = await deliver(store, checkoutEvent({ metadata: {} }));

    expect(result.status).toBe(400);
    expect(await store.findSubscription('tenant_a')).toBeNull();
  });

  it('fails loudly for a plan that is not in the catalogue, so Stripe retries', async () => {
    const store = newStore();
    const payload = checkoutEvent({ skuId: 'unknown' });

    await expect(deliver(store, payload)).rejects.toThrow('Unknown plan unknown.');
    expect(await store.findSubscription('tenant_a')).toBeNull();
  });

  it('releases the claim when activation fails so the retry is applied', async () => {
    const store = newStore();
    const flaky: BillingStore = {
      ...store,
      activateStripeSubscription: vi
        .fn<BillingStore['activateStripeSubscription']>()
        .mockRejectedValueOnce(new Error('database unavailable'))
        .mockImplementation(store.activateStripeSubscription),
    };
    const payload = checkoutEvent();

    await expect(deliver(flaky, payload)).rejects.toThrow('database unavailable');
    const retry = await deliver(flaky, payload);

    expect(retry.message).toBe('Subscription activated.');
    expect(await store.findSubscription('tenant_a')).not.toBeNull();
  });
});

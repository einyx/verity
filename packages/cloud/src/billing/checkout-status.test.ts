import { describe, expect, it, vi } from 'vitest';

import { type CheckoutConfig, readCheckoutStatus } from './checkout.js';

const config: CheckoutConfig = {
  stripeSecretKey: 'sk_test_example',
  priceIdBySkuId: { pro: 'price_pro' },
  returnOrigins: ['https://console.logto.app'],
};

const stripeSession = (body: unknown, ok = true) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status: ok ? 200 : 404 }));

const metadata = { tenantId: 'tenant_a', skuId: 'pro' };

describe('readCheckoutStatus', () => {
  it('reports complete for a paid session and returns its tenant', async () => {
    const fetcher = stripeSession({ status: 'complete', payment_status: 'paid', metadata });

    expect(await readCheckoutStatus(config, 'cs_1', fetcher)).toEqual({
      tenantId: 'tenant_a',
      skuId: 'pro',
      status: 'complete',
    });
  });

  it('reports open for a session the customer has not paid', async () => {
    const fetcher = stripeSession({ status: 'open', payment_status: 'unpaid', metadata });

    expect(await readCheckoutStatus(config, 'cs_1', fetcher)).toMatchObject({ status: 'open' });
  });

  it('returns nothing when Stripe does not know the session', async () => {
    const fetcher = stripeSession({ error: { message: 'No such session' } }, false);

    expect(await readCheckoutStatus(config, 'cs_missing', fetcher)).toBeUndefined();
  });

  it('returns nothing when the session carries no tenant', async () => {
    const fetcher = stripeSession({ status: 'complete', payment_status: 'paid', metadata: {} });

    expect(await readCheckoutStatus(config, 'cs_1', fetcher)).toBeUndefined();
  });
});

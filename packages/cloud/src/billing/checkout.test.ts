import { describe, expect, it, vi } from 'vitest';

import { type CheckoutConfig, createCheckoutSession, readCheckoutStatus } from './checkout.js';

const config: CheckoutConfig = {
  stripeSecretKey: 'sk_test_example',
  priceIdBySkuId: { pro: 'price_pro' },
  returnOrigins: ['https://console.logto.app'],
};

const input = {
  tenantId: 'tenant_a',
  skuId: 'pro',
  successCallbackUrl: 'https://console.logto.app/checkout-success?state=abc',
};

const stripeOk = () =>
  vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/1' }), {
        status: 200,
      })
  );

describe('createCheckoutSession', () => {
  it('starts a subscription checkout with the server-side price and the tenant metadata', async () => {
    const fetcher = stripeOk();

    const outcome = await createCheckoutSession(config, input, fetcher);
    const init = fetcher.mock.calls[0]?.[1];
    const form = init?.body;

    expect(outcome).toEqual({
      ok: true,
      redirectUri: 'https://checkout.stripe.com/c/1',
      sessionId: 'cs_test_1',
    });
    expect(form).toBeInstanceOf(URLSearchParams);

    if (form instanceof URLSearchParams) {
      expect(form.get('line_items[0][price]')).toBe('price_pro');
      expect(form.get('client_reference_id')).toBe('tenant_a');
      expect(form.get('metadata[tenantId]')).toBe('tenant_a');
      expect(form.get('metadata[skuId]')).toBe('pro');
    }
  });

  it('refuses a plan with no price, without calling Stripe', async () => {
    const fetcher = stripeOk();

    const outcome = await createCheckoutSession(config, { ...input, skuId: 'enterprise' }, fetcher);

    expect(outcome).toMatchObject({ ok: false, status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['another host', 'https://evil.example/checkout-success'],
    ['a host that starts with the allowed one', 'https://console.logto.app.evil.example/cb'],
    ['a different scheme', 'http://console.logto.app/cb'],
    ['an unparsable URL', 'not a url'],
  ])('refuses a return URL on %s without calling Stripe', async (_, successCallbackUrl) => {
    const fetcher = stripeOk();

    const outcome = await createCheckoutSession(config, { ...input, successCallbackUrl }, fetcher);

    expect(outcome).toMatchObject({ ok: false, status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('passes on the Stripe error when Stripe refuses the session', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ error: { message: 'No such price' } }), { status: 400 })
    );

    const outcome = await createCheckoutSession(config, input, fetcher);

    expect(outcome).toEqual({ ok: false, status: 502, message: 'No such price' });
  });
});

describe('readCheckoutStatus', () => {
  it('reads tenant and SKU metadata from a paid Stripe session', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            id: 'cs_test_1',
            status: 'complete',
            payment_status: 'paid',
            metadata: { tenantId: 'tenant_a', skuId: 'pro' },
          }),
          { status: 200 }
        )
    );

    await expect(readCheckoutStatus(config, 'cs_test_1', fetcher)).resolves.toEqual({
      tenantId: 'tenant_a',
      skuId: 'pro',
      status: 'complete',
    });
  });
});

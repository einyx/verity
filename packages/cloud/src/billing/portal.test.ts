import { describe, expect, it, vi } from 'vitest';

import { type CheckoutConfig, createPortalSession } from './checkout.js';

const config: CheckoutConfig = {
  stripeSecretKey: 'sk_test_example',
  priceIdBySkuId: { pro: 'price_pro' },
  returnOrigins: ['https://console.logto.app'],
};

describe('createPortalSession', () => {
  it('opens a billing portal for the customer and returns its URL', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ url: 'https://billing.stripe.com/p/session/1' }))
    );

    const outcome = await createPortalSession(
      config,
      { customerId: 'cus_1', returnUrl: 'https://console.logto.app/tenant-settings' },
      fetcher
    );
    const form = fetcher.mock.calls[0]?.[1]?.body;

    expect(outcome).toEqual({ ok: true, redirectUri: 'https://billing.stripe.com/p/session/1' });
    expect(form).toBeInstanceOf(URLSearchParams);

    if (form instanceof URLSearchParams) {
      expect(form.get('customer')).toBe('cus_1');
    }
  });

  it('refuses a return URL outside the allowed origins without calling Stripe', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{}'));

    const outcome = await createPortalSession(
      config,
      { customerId: 'cus_1', returnUrl: 'https://evil.example/back' },
      fetcher
    );

    expect(outcome).toMatchObject({ ok: false, status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('passes on the Stripe error when the portal cannot be opened', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ error: { message: 'No such customer' } }), { status: 400 })
    );

    const outcome = await createPortalSession(
      config,
      { customerId: 'cus_missing', returnUrl: 'https://console.logto.app/x' },
      fetcher
    );

    expect(outcome).toEqual({ ok: false, status: 502, message: 'No such customer' });
  });
});

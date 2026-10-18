import { z } from 'zod';

/** The body the console sends to start a checkout. */
export const createCheckoutBodyGuard = z.object({
  tenantId: z.string(),
  skuId: z.string(),
  successCallbackUrl: z.string(),
});

export type CheckoutConfig = {
  stripeSecretKey: string;
  /** The Stripe price of each SKU that can be bought. A SKU without a price cannot be checked out. */
  priceIdBySkuId: Record<string, string>;
  /** Origins a checkout may return to. Matched exactly, including scheme and port. */
  returnOrigins: string[];
};

export type CheckoutOutcome =
  | { ok: true; redirectUri: string; sessionId: string }
  | { ok: false; status: 400 | 502; message: string };

const stripeSessionGuard = z.object({
  id: z.string(),
  url: z.string().nullable(),
});

const stripeErrorGuard = z.object({
  error: z.object({ message: z.string().optional() }).optional(),
});

const parseReturnUrl = (value: string, origins: string[]): string | undefined => {
  try {
    const url = new URL(value);

    return origins.includes(url.origin) ? url.href : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Starts a subscription checkout in Stripe for one tenant. The tenant comes from the caller who was
 * authorized for it, the price from the server-side SKU map, and the return URL from the allowlist.
 */
export const createCheckoutSession = async (
  config: CheckoutConfig,
  input: { tenantId: string; skuId: string; successCallbackUrl: string },
  fetcher: typeof fetch = fetch
): Promise<CheckoutOutcome> => {
  if (!Object.hasOwn(config.priceIdBySkuId, input.skuId)) {
    return { ok: false, status: 400, message: 'This plan cannot be purchased.' };
  }

  const returnUrl = parseReturnUrl(input.successCallbackUrl, config.returnOrigins);

  if (!returnUrl) {
    return {
      ok: false,
      status: 400,
      message: 'The success callback must be on an allowed origin.',
    };
  }

  const priceId = config.priceIdBySkuId[input.skuId] ?? '';
  const form = new URLSearchParams({
    mode: 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    success_url: returnUrl,
    cancel_url: returnUrl,
    client_reference_id: input.tenantId,
    'metadata[tenantId]': input.tenantId,
    'metadata[skuId]': input.skuId,
  });
  const response = await fetcher('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  });
  const body: unknown = await response.json();
  const session = stripeSessionGuard.safeParse(body);

  if (!response.ok || !session.success || !session.data.url) {
    const failure = stripeErrorGuard.safeParse(body);
    const stripeMessage = failure.success ? failure.data.error?.message : undefined;

    return { ok: false, status: 502, message: stripeMessage ?? 'Stripe checkout failed.' };
  }

  return { ok: true, redirectUri: session.data.url, sessionId: session.data.id };
};

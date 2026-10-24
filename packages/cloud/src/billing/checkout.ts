import { z } from 'zod';

/** Longest a single Stripe API call may take. A hung call must not stall checkout or a webhook. */
export const stripeRequestTimeoutMs = 10_000;

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
    signal: AbortSignal.timeout(stripeRequestTimeoutMs),
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

const stripeStatusGuard = z.object({
  status: z.string().nullable().optional(),
  payment_status: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

export type CheckoutStatus = {
  tenantId: string;
  skuId: string;
  status: 'complete' | 'open';
};

/**
 * Reads a checkout session from Stripe. It reports `complete` only once Stripe has the payment, and
 * returns the tenant the session was created for, so the caller can be authorized for that tenant.
 * Returns `undefined` when Stripe does not know the session or it carries no tenant.
 */
export const readCheckoutStatus = async (
  config: CheckoutConfig,
  sessionId: string,
  fetcher: typeof fetch = fetch
): Promise<CheckoutStatus | undefined> => {
  const response = await fetcher(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    {
      headers: { Authorization: `Bearer ${config.stripeSecretKey}` },
      signal: AbortSignal.timeout(stripeRequestTimeoutMs),
    }
  );

  if (!response.ok) {
    return undefined;
  }

  const parsed = stripeStatusGuard.safeParse(await response.json());

  if (!parsed.success || !parsed.data.metadata?.tenantId || !parsed.data.metadata.skuId) {
    return undefined;
  }

  const { data } = parsed;
  const paid =
    data.status === 'complete' &&
    ['paid', 'no_payment_required'].includes(data.payment_status ?? '');

  return {
    tenantId: data.metadata?.tenantId ?? '',
    skuId: data.metadata?.skuId ?? '',
    status: paid ? 'complete' : 'open',
  };
};

export type PortalOutcome =
  { ok: true; redirectUri: string } | { ok: false; status: 400 | 502; message: string };

const portalSessionGuard = z.object({ url: z.string().nullable() });

/**
 * Opens Stripe's hosted billing portal for a customer, where a card can be added or changed. The
 * return URL must be on an allowed origin, the same rule as checkout.
 */
export const createPortalSession = async (
  config: CheckoutConfig,
  input: { customerId: string; returnUrl: string },
  fetcher: typeof fetch = fetch
): Promise<PortalOutcome> => {
  const returnUrl = parseReturnUrl(input.returnUrl, config.returnOrigins);

  if (!returnUrl) {
    return { ok: false, status: 400, message: 'The return URL must be on an allowed origin.' };
  }

  const response = await fetcher('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ customer: input.customerId, return_url: returnUrl }),
    signal: AbortSignal.timeout(stripeRequestTimeoutMs),
  });
  const body: unknown = await response.json();
  const session = portalSessionGuard.safeParse(body);

  if (!response.ok || !session.success || !session.data.url) {
    const failure = stripeErrorGuard.safeParse(body);
    const stripeMessage = failure.success ? failure.data.error?.message : undefined;

    return { ok: false, status: 502, message: stripeMessage ?? 'Stripe billing portal failed.' };
  }

  return { ok: true, redirectUri: session.data.url };
};

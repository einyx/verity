import { text } from 'node:stream/consumers';

import { ReservedPlanId, TenantTag } from '@logto/schemas';
import { sql } from '@silverhand/slonik';
import type { Context } from 'koa';
import { z } from 'zod/v3';

import { EnvSet } from '#src/env-set/index.js';

import {
  getCheckoutSession,
  saveCheckoutSession,
  tenantId,
  upgradeLocalTenant,
} from './cloud-dev-state.js';

const checkoutBodySchema = z.object({
  skuId: z.string().optional(),
  tenantId: z.string().optional(),
  successCallbackUrl: z.string().optional(),
});

type CheckoutBody = z.infer<typeof checkoutBodySchema>;

const stripeCreatedSchema = z.object({
  id: z.string().optional(),
  url: z.string().optional(),
  error: z.object({ message: z.string().optional() }).optional(),
});

const stripeSessionSchema = z.object({
  status: z.string().optional(),
  payment_status: z.string().optional(),
  metadata: z.record(z.string()).optional(),
});

type StripeSession = z.infer<typeof stripeSessionSchema>;

/** Whether a URL is on the given origin. Exact origin match, so prefix or suffix lookalikes fail. */
const isSameOrigin = (url: string, origin: string) => {
  try {
    return new URL(url).origin === origin;
  } catch {
    // An unparsable URL cannot be on the origin, so it is refused.
    return false;
  }
};

const reject = (ctx: Context, status: number, code: string, message: string) => {
  ctx.status = status;
  ctx.body = { code, message };
};

const readCheckoutBody = async (ctx: Context): Promise<CheckoutBody> => {
  const raw: unknown = JSON.parse((await text(ctx.req)) || '{}');
  const parsed = checkoutBodySchema.safeParse(raw);

  return parsed.success ? parsed.data : {};
};

/** The stand-in serves a single tenant, so checkout is bound to it and must return to this instance. */
const isValidCheckout = (ctx: Context, body: CheckoutBody) => {
  if (body.tenantId && body.tenantId !== tenantId) {
    reject(
      ctx,
      403,
      'checkout.tenant_mismatch',
      'Checkout is only allowed for the current tenant.'
    );
    return false;
  }

  if (!isSameOrigin(body.successCallbackUrl ?? '', `${ctx.protocol}://${ctx.host}`)) {
    reject(
      ctx,
      400,
      'checkout.invalid_callback_url',
      'The success callback must be on this origin.'
    );
    return false;
  }

  return true;
};

const createStripeCheckout = async (
  ctx: Context,
  stripeKey: string,
  body: CheckoutBody,
  skuId: string
) => {
  const form = new URLSearchParams({
    mode: 'subscription',
    'line_items[0][price]': process.env.STRIPE_PRO_PRICE_ID ?? '',
    'line_items[0][quantity]': '1',
    success_url: body.successCallbackUrl ?? '',
    cancel_url: body.successCallbackUrl ?? '',
    client_reference_id: tenantId,
    'metadata[tenantId]': tenantId,
    'metadata[skuId]': skuId,
  });
  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  });
  const parsed = stripeCreatedSchema.safeParse(await response.json());
  const session: z.infer<typeof stripeCreatedSchema> = parsed.success ? parsed.data : {};

  if (!response.ok || !session.id || !session.url) {
    reject(ctx, 502, 'stripe.checkout_failed', session.error?.message ?? 'Stripe checkout failed');
    return;
  }

  ctx.body = { redirectUri: session.url, sessionId: session.id };
};

/** Without Stripe, the local flip moves a tenant to production with no payment. Production must not do that. */
const markTenantProduction = async (tenantToMark: string) => {
  const pool = await EnvSet.sharedPool;
  await pool.query(
    sql`update tenants set tag = ${TenantTag.Production} where id = ${tenantToMark}`
  );
};

const createLocalCheckout = async (ctx: Context, body: CheckoutBody, skuId: string) => {
  if (EnvSet.values.isProduction) {
    reject(ctx, 503, 'checkout.not_configured', 'Checkout is not configured.');
    return;
  }

  const sessionId = `local_${Date.now()}`;
  upgradeLocalTenant();
  // The console reads the tenant's tag from the tenants table, so the upgrade has to reach that row.
  await markTenantProduction(tenantId);
  saveCheckoutSession(sessionId, { tenantId, skuId });
  ctx.body = { redirectUri: body.successCallbackUrl ?? '', sessionId };
};

export const handleCheckoutCreate = async (ctx: Context, stripeKey: string | undefined) => {
  const body = await readCheckoutBody(ctx);

  if (!isValidCheckout(ctx, body)) {
    return;
  }

  const skuId = body.skuId ?? ReservedPlanId.Pro202509;

  if (stripeKey) {
    await createStripeCheckout(ctx, stripeKey, body, skuId);
    return;
  }

  await createLocalCheckout(ctx, body, skuId);
};

const isPaid = (session: StripeSession) =>
  session.status === 'complete' &&
  ['paid', 'no_payment_required'].includes(session.payment_status ?? '');

const handleStripeStatus = async (ctx: Context, stripeKey: string, sessionId: string) => {
  const response = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    { headers: { Authorization: `Bearer ${stripeKey}` } }
  );
  const parsed = stripeSessionSchema.safeParse(await response.json());
  const session: StripeSession = parsed.success ? parsed.data : {};
  // Only a session created for this tenant may upgrade it. A paid session for another tenant
  // must not flip this one.
  const paid = session.metadata?.tenantId === tenantId && isPaid(session);

  if (paid) {
    upgradeLocalTenant();
    await markTenantProduction(tenantId);
  }

  ctx.body = {
    tenantId: session.metadata?.tenantId ?? tenantId,
    skuId: session.metadata?.skuId ?? ReservedPlanId.Pro202509,
    status: paid ? 'complete' : 'open',
  };
};

export const handleCheckoutStatus = async (
  ctx: Context,
  stripeKey: string | undefined,
  sessionId: string
) => {
  if (stripeKey && sessionId.startsWith('cs_')) {
    await handleStripeStatus(ctx, stripeKey, sessionId);
    return;
  }

  const session = getCheckoutSession(sessionId);
  ctx.body = session ? { ...session, status: 'complete' } : { status: 'open' };
};

import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { type BillingStore } from './store.js';

/** Stripe rejects signed payloads whose timestamp is further than this from the current time. */
const toleranceSeconds = 300;

const thirtyDaysSeconds = 30 * 24 * 60 * 60;

const eventGuard = z.object({
  id: z.string(),
  type: z.string(),
  data: z.object({ object: z.unknown() }),
});

const checkoutSessionGuard = z.object({
  status: z.string(),
  payment_status: z.string(),
  customer: z.string(),
  subscription: z.string(),
  metadata: z.object({ tenantId: z.string(), skuId: z.string() }),
});

export type StripeWebhookResult = { status: number; message: string };

const parseJson = (payload: string): unknown => {
  try {
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
};

/**
 * Checks a `Stripe-Signature` header against the raw request body. The header carries a timestamp
 * (`t=`) and one or more `v1=` signatures. Any signature that matches within the tolerance passes.
 */
export const verifyStripeSignature = (input: {
  payload: string;
  header: string | undefined;
  secret: string;
  nowSeconds: number;
}): boolean => {
  const timestamp = /(?:^|,)t=(\d+)/.exec(input.header ?? '')?.[1];
  const signatures = [...(input.header ?? '').matchAll(/(?:^|,)v1=([\da-f]+)/g)].flatMap((match) =>
    match[1] ? [match[1]] : []
  );

  if (!timestamp || signatures.length === 0) {
    return false;
  }

  if (Math.abs(input.nowSeconds - Number(timestamp)) > toleranceSeconds) {
    return false;
  }

  const expected = Buffer.from(
    createHmac('sha256', input.secret).update(`${timestamp}.${input.payload}`).digest('hex'),
    'hex'
  );

  return signatures.some((signature) => {
    const actual = Buffer.from(signature, 'hex');

    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
};

/**
 * Applies a signed Stripe webhook. Only `checkout.session.completed` changes state: a paid checkout
 * makes the tenant's subscription the Stripe subscription it bought. Every other event is ignored.
 *
 * A failure after the event is claimed releases the claim and rethrows, so Stripe's retry runs the
 * event again. A redelivered event that was already applied returns 200 without changing anything.
 */
export const processStripeWebhook = async (input: {
  payload: string;
  signature: string | undefined;
  secret: string;
  store: BillingStore;
  nowSeconds: number;
}): Promise<StripeWebhookResult> => {
  if (!verifyStripeSignature({ ...input, header: input.signature })) {
    return { status: 401, message: 'Invalid signature.' };
  }

  const parsed = eventGuard.safeParse(parseJson(input.payload));

  if (!parsed.success) {
    return { status: 400, message: 'Malformed event.' };
  }

  const event = parsed.data;

  if (event.type !== 'checkout.session.completed') {
    return { status: 200, message: 'Event type not handled.' };
  }

  const session = checkoutSessionGuard.safeParse(event.data.object);

  if (!session.success) {
    return { status: 400, message: 'Malformed checkout session.' };
  }

  const { data } = session;

  if (data.status !== 'complete' || data.payment_status !== 'paid') {
    return { status: 200, message: 'Checkout is not paid; nothing to activate.' };
  }

  if (!(await input.store.claimStripeEvent(event.id, event.type))) {
    return { status: 200, message: 'Event already processed.' };
  }

  const periodStart = new Date(input.nowSeconds * 1000);

  try {
    // The period is a placeholder until `customer.subscription.updated` (a later slice) sets the
    // real one from Stripe.
    await input.store.activateStripeSubscription({
      tenantId: data.metadata.tenantId,
      planId: data.metadata.skuId,
      stripeCustomerId: data.customer,
      stripeSubscriptionId: data.subscription,
      periodStart,
      periodEnd: new Date(periodStart.getTime() + thirtyDaysSeconds * 1000),
    });
  } catch (error: unknown) {
    await input.store.releaseStripeEvent(event.id);
    throw error;
  }

  return { status: 200, message: 'Subscription activated.' };
};

import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { type BillingStore } from './store.js';
import { subscriptionStatusGuard } from './subscription.js';

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

const stripeSubscriptionGuard = z.object({
  id: z.string(),
  status: z.string(),
  current_period_start: z.number(),
  current_period_end: z.number(),
});

export type StripeWebhookResult = { status: number; message: string };

/** What an event asks for: nothing, a rejected payload, or a state change to apply once claimed. */
type EventPlan =
  | { kind: 'ignore'; message: string }
  | { kind: 'malformed'; message: string }
  | { kind: 'apply'; message: string; apply: (store: BillingStore) => Promise<void> };

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

const planCheckoutCompleted = (object: unknown, nowSeconds: number): EventPlan => {
  const parsed = checkoutSessionGuard.safeParse(object);

  if (!parsed.success) {
    return { kind: 'malformed', message: 'Malformed checkout session.' };
  }

  const { data } = parsed;

  if (data.status !== 'complete' || data.payment_status !== 'paid') {
    return { kind: 'ignore', message: 'Checkout is not paid; nothing to activate.' };
  }

  const periodStart = new Date(nowSeconds * 1000);

  return {
    kind: 'apply',
    message: 'Subscription activated.',
    apply: async (store) => {
      // The period is a placeholder until the subscription's own events set the real one.
      await store.activateStripeSubscription({
        tenantId: data.metadata.tenantId,
        planId: data.metadata.skuId,
        stripeCustomerId: data.customer,
        stripeSubscriptionId: data.subscription,
        periodStart,
        periodEnd: new Date(periodStart.getTime() + thirtyDaysSeconds * 1000),
      });
    },
  };
};

const planSubscriptionChanged = (object: unknown, overrideStatus?: 'canceled'): EventPlan => {
  const parsed = stripeSubscriptionGuard.safeParse(object);
  const status = subscriptionStatusGuard.safeParse(parsed.data?.status);

  if (!parsed.success || !status.success) {
    return { kind: 'malformed', message: 'Malformed subscription.' };
  }

  const { data } = parsed;

  return {
    kind: 'apply',
    message: overrideStatus ? 'Subscription canceled.' : 'Subscription updated.',
    apply: async (store) => {
      await store.updateStripeSubscription({
        stripeSubscriptionId: data.id,
        status: overrideStatus ?? status.data,
        periodStart: new Date(data.current_period_start * 1000),
        periodEnd: new Date(data.current_period_end * 1000),
      });
    },
  };
};

const planners: Record<string, (object: unknown, nowSeconds: number) => EventPlan> = {
  'checkout.session.completed': planCheckoutCompleted,
  'customer.subscription.updated': (object) => planSubscriptionChanged(object),
  // Deletion ends the subscription. Moving the tenant to a free plan is a product decision that
  // this slice does not make; the subscription is only marked canceled.
  'customer.subscription.deleted': (object) => planSubscriptionChanged(object, 'canceled'),
};

/**
 * Applies a signed Stripe webhook. Paid checkouts activate the tenant's subscription, and
 * subscription updates and deletions keep its status and period in step with Stripe. Every other
 * event is ignored.
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
  const planner = Object.hasOwn(planners, event.type) ? planners[event.type] : undefined;
  const plan = planner?.(event.data.object, input.nowSeconds) ?? {
    kind: 'ignore' as const,
    message: 'Event type not handled.',
  };

  if (plan.kind === 'malformed') {
    return { status: 400, message: plan.message };
  }

  if (plan.kind === 'ignore') {
    return { status: 200, message: plan.message };
  }

  if (!(await input.store.claimStripeEvent(event.id, event.type))) {
    return { status: 200, message: 'Event already processed.' };
  }

  try {
    await plan.apply(input.store);
  } catch (error: unknown) {
    await input.store.releaseStripeEvent(event.id);
    throw error;
  }

  return { status: 200, message: plan.message };
};

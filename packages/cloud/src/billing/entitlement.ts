import { ReservedPlanId } from '@logto/schemas';

import { type Sku } from './sku.js';
import { logtoSkuQuotaGuard, type Subscription } from './subscription.js';

/** Statuses in which the paid period is over and the plan must no longer grant paid quota. */
const endedStatuses = new Set<Subscription['status']>(['canceled', 'incomplete_expired']);

/**
 * Whether a status is terminal for entitlement. Once a subscription is ended, no later event may
 * move it back to a paid status, because Stripe does not reactivate a canceled subscription.
 */
export const isEndedStatus = (status: Subscription['status']) => endedStatuses.has(status);

/**
 * The subscription a tenant is entitled to at `now`. A subscription whose status has ended keeps its
 * paid plan until its period end, and from then on reads as the development plan. Everything else is
 * returned as stored.
 *
 * Returns `undefined` when the subscription has ended but the development plan is missing or
 * incomplete. The caller must refuse the read in that case rather than grant the paid quota.
 */
export const effectiveSubscription = (
  subscription: Subscription,
  now: Date,
  developmentSku?: Sku
): Subscription | undefined => {
  const periodHasEnded = Date.parse(subscription.currentPeriodEnd) <= now.getTime();

  if (!endedStatuses.has(subscription.status) || !periodHasEnded) {
    return subscription;
  }

  const quota = logtoSkuQuotaGuard.safeParse(developmentSku?.quota);

  if (!quota.success) {
    return undefined;
  }

  return {
    ...subscription,
    planId: ReservedPlanId.Development,
    isDevPlan: true,
    quota: quota.data,
    systemLimit: {},
  };
};

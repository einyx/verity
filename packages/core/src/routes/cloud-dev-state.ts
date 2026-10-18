import { ReservedPlanId } from '@logto/schemas';

// Local stand-in state for the single local tenant. It resets on restart.

export const tenantId = 'default';
export const developmentPlanId = 'development';

type TenantStateKey = 'tag' | 'planId';

const tenantState = new Map<TenantStateKey, string>([
  ['tag', 'development'],
  ['planId', developmentPlanId],
]);

export const localTag = () => tenantState.get('tag') ?? 'development';

export const localPlanId = () => tenantState.get('planId') ?? developmentPlanId;

/** A local checkout moves the tenant to production. */
export const upgradeLocalTenant = () => {
  tenantState.set('tag', 'production');
  tenantState.set('planId', ReservedPlanId.Pro202509);
};

type CheckoutSession = { tenantId: string; skuId: string };

const checkoutSessions = new Map<string, CheckoutSession>();

export const saveCheckoutSession = (sessionId: string, session: CheckoutSession) => {
  checkoutSessions.set(sessionId, session);
};

export const getCheckoutSession = (sessionId: string) => checkoutSessions.get(sessionId);

export const now = () => new Date().toISOString();

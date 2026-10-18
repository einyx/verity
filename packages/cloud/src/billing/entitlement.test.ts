import { ReservedPlanId } from '@logto/schemas';
import { describe, expect, it } from 'vitest';

import { effectiveSubscription } from './entitlement.js';
import { skuGuard } from './sku.js';
import { type Subscription } from './subscription.js';

const quota = {
  mauLimit: 50_000,
  applicationsLimit: 3,
  thirdPartyApplicationsLimit: 0,
  scopesPerResourceLimit: 1,
  socialConnectorsLimit: 3,
  userRolesLimit: 1,
  machineToMachineRolesLimit: 1,
  scopesPerRoleLimit: 1,
  hooksLimit: 1,
  auditLogsRetentionDays: 3,
  customJwtEnabled: false,
  actionsEnabled: false,
  subjectTokenEnabled: false,
  bringYourUiEnabled: false,
  collectUserProfileEnabled: false,
  passkeySignInEnabled: false,
  tokenLimit: 500_000,
  hostedEmailLimit: 100_000,
  hostedEmailDailyLimit: 10_000,
  machineToMachineLimit: 1,
  resourcesLimit: 1,
  enterpriseSsoLimit: 0,
  consoleSsoConnectorLimit: 0,
  tenantMembersLimit: 1,
  mfaEnabled: false,
  organizationsEnabled: false,
  organizationsLimit: 0,
  idpInitiatedSsoEnabled: false,
  samlApplicationsLimit: 0,
  securityFeaturesEnabled: false,
  customDomainsLimit: 1,
};

const developmentSku = skuGuard.parse({
  type: 'Basic',
  id: ReservedPlanId.Development,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  name: 'Development',
  defaultPriceId: null,
  unitPrice: null,
  quota: { ...quota, mauLimit: 100 },
});

const periodEnd = new Date('2026-11-01T00:00:00.000Z');
const beforeEnd = new Date('2026-10-20T00:00:00.000Z');
const afterEnd = new Date('2026-11-02T00:00:00.000Z');

const paidSubscription = (status: Subscription['status']): Subscription => ({
  planId: 'pro',
  status,
  isEnterprisePlan: false,
  hasBillingCustomer: true,
  currentPeriodStart: '2026-10-01T00:00:00.000Z',
  currentPeriodEnd: periodEnd.toISOString(),
  quota,
  systemLimit: {},
});

describe('effectiveSubscription', () => {
  it('returns an active subscription as stored', () => {
    const subscription = paidSubscription('active');

    expect(effectiveSubscription(subscription, afterEnd, developmentSku)).toEqual(subscription);
  });

  it('keeps the paid plan of a canceled subscription until its period ends', () => {
    const subscription = paidSubscription('canceled');

    expect(effectiveSubscription(subscription, beforeEnd, developmentSku)).toEqual(subscription);
  });

  it('reads a canceled subscription past its period end as the development plan', () => {
    const result = effectiveSubscription(paidSubscription('canceled'), afterEnd, developmentSku);

    expect(result?.planId).toBe(ReservedPlanId.Development);
    expect(result?.isDevPlan).toBe(true);
    expect(result?.quota.mauLimit).toBe(100);
  });

  it('refuses the read when the development plan is missing', () => {
    expect(effectiveSubscription(paidSubscription('canceled'), afterEnd)).toBeUndefined();
  });

  it('leaves a past-due subscription as stored, since it is not an ended status', () => {
    const subscription = paidSubscription('past_due');

    expect(effectiveSubscription(subscription, afterEnd, developmentSku)).toEqual(subscription);
  });
});

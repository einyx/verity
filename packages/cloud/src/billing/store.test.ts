import { describe, expect, it } from 'vitest';

import { createInMemoryBillingStore } from './store.js';
import { type Subscription } from './subscription.js';

const subscription: Subscription = {
  planId: 'pro',
  currentPeriodStart: '2026-10-01T00:00:00.000Z',
  currentPeriodEnd: '2026-11-01T00:00:00.000Z',
  isEnterprisePlan: false,
  status: 'active',
  quota: {
    mauLimit: 1000,
    applicationsLimit: null,
    thirdPartyApplicationsLimit: 5,
    scopesPerResourceLimit: 10,
    socialConnectorsLimit: null,
    userRolesLimit: 10,
    machineToMachineRolesLimit: 10,
    scopesPerRoleLimit: 10,
    hooksLimit: 3,
    auditLogsRetentionDays: 30,
    customJwtEnabled: false,
    actionsEnabled: false,
    subjectTokenEnabled: false,
    bringYourUiEnabled: false,
    collectUserProfileEnabled: false,
    passkeySignInEnabled: true,
    tokenLimit: null,
    hostedEmailLimit: 100,
    hostedEmailDailyLimit: 10,
    machineToMachineLimit: 1,
    resourcesLimit: 3,
    enterpriseSsoLimit: 0,
    consoleSsoConnectorLimit: 0,
    tenantMembersLimit: 3,
    mfaEnabled: true,
    organizationsEnabled: false,
    organizationsLimit: 0,
    idpInitiatedSsoEnabled: false,
    samlApplicationsLimit: 0,
    securityFeaturesEnabled: false,
    customDomainsLimit: 0,
  },
  systemLimit: {},
};

describe('createInMemoryBillingStore', () => {
  it('returns the subscription recorded for a tenant', async () => {
    const store = createInMemoryBillingStore({ subscriptions: { tenant1: subscription } });

    await expect(store.findSubscription('tenant1')).resolves.toEqual(subscription);
  });

  it('returns null for a tenant without a subscription', async () => {
    const store = createInMemoryBillingStore({ subscriptions: { tenant1: subscription } });

    await expect(store.findSubscription('unknown')).resolves.toBeNull();
  });
});

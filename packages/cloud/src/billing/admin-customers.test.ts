import { describe, expect, it } from 'vitest';

import { skuGuard } from './sku.js';
import { createInMemoryBillingStore } from './store.js';

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

const proSku = skuGuard.parse({
  type: 'Basic',
  id: 'pro',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  name: 'Pro',
  defaultPriceId: null,
  unitPrice: null,
  quota,
});

const issuer = 'https://auth.example.test/oidc';
const alice = { issuer, sub: 'alice' };
const bob = { issuer, sub: 'bob' };
const stranger = { issuer, sub: 'stranger' };

describe('listAdminCustomers', () => {
  it('lists the customer of a tenant to its admin only', async () => {
    const store = createInMemoryBillingStore({
      skus: [proSku],
      members: {
        tenant_a: [
          { ...alice, role: 'admin' },
          { ...bob, role: 'member' },
        ],
      },
    });
    await store.activateStripeSubscription({
      tenantId: 'tenant_a',
      planId: 'pro',
      stripeCustomerId: 'cus_a',
      stripeSubscriptionId: 'sub_a',
      status: 'active',
      periodStart: new Date('2026-10-01T00:00:00.000Z'),
      periodEnd: new Date('2026-11-01T00:00:00.000Z'),
    });

    expect(await store.listAdminCustomers(alice)).toEqual([
      {
        tenantId: 'tenant_a',
        customerId: 'cus_a',
        periodStart: new Date('2026-10-01T00:00:00.000Z'),
      },
    ]);
    expect(await store.listAdminCustomers(bob)).toEqual([]);
    expect(await store.listAdminCustomers(stranger)).toEqual([]);
  });
});

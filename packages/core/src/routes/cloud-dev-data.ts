import { ReservedPlanId, TenantScope } from '@logto/schemas';

import { developmentPlanId, localPlanId, localTag, now, tenantId } from './cloud-dev-state.js';

const tenant = () => {
  const created = now();

  return {
    id: tenantId,
    name: `tenant_${tenantId}`,
    tag: localTag(),
    indicator: `https://${tenantId}.logto.app/api`,
    subscription: {
      status: 'active',
      planId: localPlanId(),
      currentPeriodStart: created,
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      isEnterprisePlan: false,
      quotaScope: 'dedicated',
    },
    usage: { activeUsers: 0, tokenUsage: 0, userTokenUsage: 0, m2mTokenUsage: 0 },
    quota: { mauLimit: null, tokenLimit: null },
    openInvoices: [],
    isSuspended: false,
    planId: localPlanId(),
    regionName: 'local',
    createdAt: created,
  };
};

const sku = () => {
  const created = now();

  return {
    id: developmentPlanId,
    name: 'Logto Development plan',
    createdAt: created,
    updatedAt: created,
    type: 'basic',
    unitPrice: 0,
    productId: null,
    defaultPriceId: null,
    isDefault: true,
    isDevPlan: true,
    quota: {
      mauLimit: 100,
      tokenLimit: null,
      applicationsLimit: null,
      machineToMachineLimit: null,
      resourcesLimit: null,
      scopesPerResourceLimit: null,
      socialConnectorsLimit: null,
      userRolesLimit: null,
      machineToMachineRolesLimit: null,
      scopesPerRoleLimit: null,
      hooksLimit: null,
      auditLogsRetentionDays: 14,
      mfaEnabled: true,
      organizationsLimit: null,
      enterpriseSsoLimit: null,
      consoleSsoConnectorLimit: 0,
      thirdPartyApplicationsLimit: null,
      tenantMembersLimit: 20,
      customJwtEnabled: true,
      actionsEnabled: false,
      subjectTokenEnabled: true,
      bringYourUiEnabled: true,
      collectUserProfileEnabled: true,
      passkeySignInEnabled: true,
      idpInitiatedSsoEnabled: false,
      samlApplicationsLimit: 3,
      securityFeaturesEnabled: true,
      customDomainsLimit: 2,
    },
  };
};

const proSku = () => ({
  ...sku(),
  id: ReservedPlanId.Pro202509,
  name: 'Logto Pro plan',
  isDefault: false,
  isDevPlan: false,
});

const subscriptionUsage = () => ({
  quota: {
    mauLimit: 50_000,
    tokenLimit: 500_000,
    hostedEmailLimit: 100_000,
    hostedEmailDailyLimit: 10_000,
    applicationsLimit: 3,
    machineToMachineLimit: 1,
    resourcesLimit: 1,
    scopesPerResourceLimit: 1,
    socialConnectorsLimit: 3,
    userRolesLimit: 1,
    machineToMachineRolesLimit: 1,
    scopesPerRoleLimit: 1,
    hooksLimit: 1,
    auditLogsRetentionDays: 3,
    mfaEnabled: false,
    organizationsLimit: 0,
    enterpriseSsoLimit: 0,
    consoleSsoConnectorLimit: 0,
    thirdPartyApplicationsLimit: 0,
    tenantMembersLimit: 1,
    customJwtEnabled: false,
    actionsEnabled: false,
    subjectTokenEnabled: false,
    bringYourUiEnabled: false,
    collectUserProfileEnabled: false,
    passkeySignInEnabled: false,
    idpInitiatedSsoEnabled: false,
    samlApplicationsLimit: 0,
    securityFeaturesEnabled: false,
    customDomainsLimit: 1,
  },
  usage: {
    applicationsLimit: 0,
    machineToMachineLimit: 0,
    resourcesLimit: 0,
    scopesPerResourceLimit: 0,
    socialConnectorsLimit: 0,
    userRolesLimit: 0,
    machineToMachineRolesLimit: 0,
    scopesPerRoleLimit: 0,
    hooksLimit: 0,
    mfaEnabled: false,
    organizationsLimit: 0,
    enterpriseSsoLimit: 0,
    thirdPartyApplicationsLimit: 0,
    tenantMembersLimit: 0,
    customJwtEnabled: false,
    actionsEnabled: false,
    bringYourUiEnabled: false,
    collectUserProfileEnabled: false,
    passkeySignInEnabled: false,
    idpInitiatedSsoEnabled: false,
    samlApplicationsLimit: 0,
    securityFeaturesEnabled: false,
    customDomainsLimit: 0,
  },
  resources: {},
  roles: {},
});

type Handler = () => unknown;

/** Exact paths the console calls. `[^/]+` matches a tenant or member id. */
export const routes: ReadonlyArray<readonly [RegExp, Handler]> = [
  // The core reads the plan quota and system limits from the subscription, so both are part of the response.
  [
    /^\/api\/tenants\/[^/]+\/subscription$/,
    () => ({ ...tenant().subscription, quota: sku().quota, systemLimit: {} }),
  ],
  [/^\/api\/tenants\/[^/]+\/subscription-usage$/, subscriptionUsage],
  // No add-ons are sold, so the local tenant has none to offer.
  [/^\/api\/tenants\/[^/]+\/subscription\/add-on-skus$/, () => []],
  [/^\/api\/tenants\/[^/]+\/available-skus$/, () => [sku(), proSku()]],
  [/^\/api\/tenants\/[^/]+\/invoices$/, () => []],
  [/^\/api\/tenants\/[^/]+\/invitations$/, () => ({ invitations: [] })],
  // The console removes a tenant from its list when the member has no scopes, so the local member
  // is granted every tenant scope.
  [
    /^\/api\/tenants\/[^/]+\/members\/[^/]+\/scopes$/,
    () => Object.values(TenantScope).map((name) => ({ name })),
  ],
  [/^\/api\/skus$/, () => [sku()]],
  [/^\/api\/invitations$/, () => []],
  // Tenant settings. MFA is off until the local tenant can change it.
  [/^\/api\/tenants\/[^/]+\/settings$/, () => ({ isMfaRequired: false })],
  [
    /^\/api\/me\/regions$/,
    () => ({
      regions: [
        {
          id: 'local',
          name: 'local',
          displayName: 'Local',
          country: 'Local',
          tags: [],
          isPrivate: false,
        },
      ],
    }),
  ],
  [/^\/api\/me\/logto-enterprises$/, () => ({ logtoEnterprises: [] })],
  [/^\/api\/me\/self-hosted-licenses$/, () => []],
];

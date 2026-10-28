import { ossDefaultQuota } from '@logto/schemas';
import { renderHook, waitFor } from '@testing-library/react';
import { useContext, useMemo, type ReactNode } from 'react';
import { SWRConfig } from 'swr';

import { defaultSubscriptionQuota, defaultSubscriptionUsage } from '@/consts';
import { TenantsContext } from '@/contexts/TenantsProvider';

import useSubscriptionData from './use-subscription-data';

const mockGet = jest.fn();
const cloudApi = { get: mockGet };

// The client package is ESM-only; this hook does not use its error class.
jest.mock('@withtyped/client', () => ({ ResponseError: jest.fn() }), { virtual: true });
jest.mock('@/consts/env', () => ({ isCloud: true, isDevFeaturesEnabled: false }));
jest.mock('@/cloud/hooks/use-cloud-api', () => ({ useCloudApi: () => cloudApi }));
jest.mock('@/hooks/use-license', () => ({
  __esModule: true,
  default: () => ({ licenseQuota: ossDefaultQuota, isLoading: false, mutate: jest.fn() }),
}));

const renderSubscription = (tenantId: string) => {
  const config = { provider: () => new Map(), dedupingInterval: 0 };
  function Wrapper({ children }: { readonly children: ReactNode }) {
    const tenants = useContext(TenantsContext);
    const value = useMemo(() => ({ ...tenants, currentTenantId: tenantId }), [tenants]);
    return (
      <SWRConfig value={config}>
        <TenantsContext.Provider value={value}>{children}</TenantsContext.Provider>
      </SWRConfig>
    );
  }
  return renderHook(useSubscriptionData, { wrapper: Wrapper });
};

const mockResponses = (quota?: typeof defaultSubscriptionQuota) => {
  mockGet.mockImplementation(async (path: string) => {
    if (path.endsWith('/subscription')) {
      return { status: 'active', planId: 'enterprise', isEnterprisePlan: true, quota };
    }
    if (path.endsWith('/subscription-usage')) {
      return {
        quota: { ...defaultSubscriptionQuota, passkeySignInEnabled: false },
        usage: defaultSubscriptionUsage,
      };
    }
    return [];
  });
};

it.each(['admin', 'default'])(
  'uses the actual %s subscription quota instead of demo limits',
  async (tenantId) => {
    mockResponses({ ...defaultSubscriptionQuota, passkeySignInEnabled: true });
    const { result } = renderSubscription(tenantId);
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.currentSubscription.isEnterprisePlan).toBe(true);
    expect(result.current.currentSubscriptionQuota.passkeySignInEnabled).toBe(true);
    expect(result.current.currentSubscriptionBasicQuota.passkeySignInEnabled).toBe(true);
  }
);

it('retains usage quotas when the Cloud subscription has no quota snapshot', async () => {
  mockResponses();
  const { result } = renderSubscription('default');
  await waitFor(() => {
    expect(result.current.isLoading).toBe(false);
  });
  expect(result.current.currentSubscriptionQuota.passkeySignInEnabled).toBe(false);
});

it('does not grant passkeys just because the subscription is labelled Enterprise', async () => {
  mockResponses({ ...defaultSubscriptionQuota, passkeySignInEnabled: false });
  const { result } = renderSubscription('default');
  await waitFor(() => {
    expect(result.current.isLoading).toBe(false);
  });
  expect(result.current.currentSubscriptionQuota.passkeySignInEnabled).toBe(false);
});

import { useLogto } from '@logto/react';
import { renderHook } from '@testing-library/react';
import ky, { type NormalizedOptions } from 'ky';
import { useContext, useMemo, type ReactNode } from 'react';

import { TenantsContext } from '@/contexts/TenantsProvider';
import { mockEnv, resetMockEnv, type EnvTestUtils } from '@/test-utils/env';

import useApi, { useGlobalRequestErrorHandler } from './use-api';

const mockSignOut = jest.fn();
const mockToastError = jest.fn();

jest.mock('@/consts/env', () => jest.requireActual<EnvTestUtils>('@/test-utils/env').mockEnvModule);
jest.mock('@/components/Region', () => ({ defaultRegionName: 'US' }));
jest.mock('@logto/react', () => ({ useLogto: jest.fn() }));
jest.mock('./use-sign-out', () => ({
  __esModule: true,
  default: () => ({ signOut: mockSignOut }),
}));
jest.mock('@/hooks/use-confirm-modal', () => ({ useConfirmModal: () => ({ show: jest.fn() }) }));
jest.mock('@/hooks/use-redirect-uri', () => ({
  __esModule: true,
  default: () => new URL('https://admin.example.com/console/callback'),
}));
jest.mock('react-hot-toast', () => ({
  toast: { error: (message: string) => mockToastError(message) },
}));

/** Body of the Cloud Management API proxy's 403 for a missing tenant scope. */
const insufficientPermissions = { message: 'Insufficient permissions.' };

describe('useGlobalRequestErrorHandler', () => {
  beforeEach(() => {
    resetMockEnv();
    jest.clearAllMocks();
  });

  it('shows an insufficient permissions 403 as a toast instead of signing out', async () => {
    const { result } = renderHook(() => useGlobalRequestErrorHandler());

    await result.current.handleError({
      status: 403,
      clone: () => ({ json: async () => insufficientPermissions }),
    } as Response);

    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringContaining('Insufficient permissions.')
    );
  });
});

function AdminTenantWrapper({ children }: { readonly children: ReactNode }) {
  const tenants = useContext(TenantsContext);
  const value = useMemo(() => ({ ...tenants, currentTenantId: 'admin' }), [tenants]);
  return <TenantsContext.Provider value={value}>{children}</TenantsContext.Provider>;
}

it('uses the tenant organization token for the admin tenant API', async () => {
  mockEnv({ isCloud: true });
  const getOrganizationToken = jest.fn().mockResolvedValue('tenant-token');
  const getAccessToken = jest.fn().mockResolvedValue('management-token');
  jest.mocked(useLogto).mockReturnValue({
    isAuthenticated: true,
    getOrganizationToken,
    getAccessToken,
  } as unknown as ReturnType<typeof useLogto>);
  const create = jest.spyOn(ky, 'create');

  renderHook(() => useApi(), {
    wrapper: AdminTenantWrapper,
  });

  const beforeRequest = create.mock.calls.at(-1)?.[0]?.hooks?.beforeRequest?.[0];
  const setHeader = jest.fn();
  await beforeRequest?.(
    { headers: { set: setHeader } } as unknown as Request,
    {} as NormalizedOptions,
    { retryCount: 0 }
  );
  expect(getOrganizationToken).toHaveBeenCalledWith('t-admin');
  expect(getAccessToken).not.toHaveBeenCalled();
  expect(setHeader).toHaveBeenCalledWith('Authorization', 'Bearer tenant-token');
  create.mockRestore();
  resetMockEnv();
});

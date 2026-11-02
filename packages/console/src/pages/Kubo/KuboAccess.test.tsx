import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createContext, useState, type ReactNode } from 'react';
import { SWRConfig } from 'swr';

import { TenantsContext } from '@/contexts/TenantsProvider';

import KuboAccess, { useKuboAccess, useKuboMutationAccess } from './KuboAccess';

const claims = jest.fn(async () => ({ sub: 'actor-a', iat: 1 }));
const get = jest.fn();
const capabilities = (all = false, canMutate = true, canViewAll = false) => ({
  canViewAll,
  canMutate,
  operator: all,
  tenantScoped: !all,
  tenantMutationsEnabled: true,
});
jest.mock('@logto/react', () => ({
  useLogto: () => ({ isAuthenticated: true, getIdTokenClaims: claims }),
}));
jest.mock('@/hooks/use-api', () => ({ __esModule: true, default: () => ({ get }) }));
jest.mock('@/contexts/TenantsProvider', () => ({
  TenantsContext: createContext({ currentTenantId: 'a' }),
}));
jest.mock('@/components/RequestDataError', () => ({
  __esModule: true,
  default: () => <p role="alert">Discovery failed</p>,
}));
jest.mock('@/ds-components/Checkbox', () => ({
  __esModule: true,
  default: ({
    label,
    checked,
    onChange,
  }: {
    label: ReactNode;
    checked: boolean;
    onChange: (value: boolean) => void;
  }) => (
    <label>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
      {label}
    </label>
  ),
}));

function MutationFlow() {
  const access = useKuboMutationAccess();
  return (
    <button type="button" disabled={!access.canMutate}>
      Flow create
    </button>
  );
}

function Actions({ denialStatus }: { readonly denialStatus: number }) {
  const access = useKuboAccess();
  const [isFlowOpen, setIsFlowOpen] = useState(false);
  return (
    <>
      <p>{access.scope}</p>
      <button
        type="button"
        onClick={() => {
          setIsFlowOpen(true);
        }}
      >
        Start new flow
      </button>
      {isFlowOpen && <MutationFlow />}
      <button type="button" disabled={!access.canMutate}>
        Create
      </button>
      <button
        type="button"
        onClick={() => {
          void access.onDenied({ status: denialStatus });
        }}
      >
        Simulate denial
      </button>
    </>
  );
}

const setup = (denialStatus = 503) => {
  const cache = new Map();
  const view = (tenantId: string) => (
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0, shouldRetryOnError: false }}>
      <TenantsContext.Provider
        value={{ currentTenantId: tenantId } as React.ContextType<typeof TenantsContext>}
      >
        <KuboAccess>
          <Actions denialStatus={denialStatus} />
        </KuboAccess>
      </TenantsContext.Provider>
    </SWRConfig>
  );
  const result = render(view('a'));
  return {
    ...result,
    switchTenant: (tenantId: string) => {
      result.rerender(view(tenantId));
    },
  };
};

beforeEach(() => {
  get.mockReset();
  claims.mockClear();
});

it('normal users cannot activate all scope; unknown capabilities disable mutations', async () => {
  const response: { resolve?: (value: ReturnType<typeof capabilities>) => void } = {};
  get.mockReturnValue({
    json: async () =>
      new Promise((resolve) => {
        // eslint-disable-next-line @silverhand/fp/no-mutating-assign -- Capture the deferred network fixture resolver.
        Object.assign(response, { resolve });
      }),
  });
  setup();
  await waitFor(() => {
    expect(get).toHaveBeenCalled();
  });
  expect(screen.getByRole('button', { name: 'Create' })).toHaveProperty('disabled', true);
  expect(screen.queryByRole('checkbox')).toBeNull();
  await act(async () => {
    response.resolve?.(capabilities());
  });
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Create' })).toHaveProperty('disabled', false);
  });
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(get.mock.calls.every(([path]) => !String(path).includes('scope=all'))).toBe(true);
});

it('read-only capabilities never enable mutations', async () => {
  get.mockReturnValue({ json: async () => capabilities(false, false) });
  setup();
  await waitFor(() => {
    expect(get).toHaveBeenCalled();
  });
  expect(screen.getByRole('button', { name: 'Create' })).toHaveProperty('disabled', true);
});

it('requires explicit verified operator scope and resets selection on tenant changes', async () => {
  get.mockImplementation((path: string) => ({
    json: async () => capabilities(path.endsWith('scope=all'), true, true),
  }));
  const { switchTenant } = setup();
  fireEvent.click(await screen.findByRole('checkbox'));
  await waitFor(() => {
    expect(screen.getByText('all')).toBeTruthy();
  });
  expect(get).toHaveBeenCalledWith('api/kubo/access?scope=all');
  switchTenant('b');
  expect(screen.queryByText('all')).toBeNull();
  expect(screen.getByText('tenant')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Create' })).toHaveProperty('disabled', true);
  await waitFor(() => {
    expect(screen.getByRole('checkbox')).toHaveProperty('checked', false);
  });
});

it.each([401, 403, 503])(
  'clears readiness after denial %s, then refetches instead of retaining a positive',
  async (status) => {
    get.mockReturnValue({ json: async () => capabilities() });
    setup(status);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create' })).toHaveProperty('disabled', false);
    });
    get.mockReturnValue({ json: async () => capabilities(false, false) });
    fireEvent.click(screen.getByRole('button', { name: 'Simulate denial' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create' })).toHaveProperty('disabled', true);
    });
    expect(get).toHaveBeenCalledTimes(2);
  }
);

it('ignores a late operator capability response after a tenant switch', async () => {
  const pending: { resolve?: (value: ReturnType<typeof capabilities>) => void } = {};
  get.mockImplementation((path: string) => ({
    json: async () =>
      path.endsWith('scope=all')
        ? new Promise((resolve) => {
            // eslint-disable-next-line @silverhand/fp/no-mutating-assign -- Deferred operator network fixture.
            Object.assign(pending, { resolve });
          })
        : capabilities(false, true, true),
  }));
  const { switchTenant } = setup();
  fireEvent.click(await screen.findByRole('checkbox'));
  await waitFor(() => {
    expect(pending.resolve).toBeDefined();
  });
  get.mockReturnValue({ json: async () => capabilities(false, false) });
  switchTenant('b');
  await act(async () => {
    pending.resolve?.(capabilities(true, true, true));
  });
  expect(screen.queryByText('all')).toBeNull();
  expect(screen.getByRole('button', { name: 'Create' })).toHaveProperty('disabled', true);
  expect(screen.queryByRole('checkbox')).toBeNull();
});

it('stays disabled when discovery fails after a mutation denial', async () => {
  get.mockReturnValue({ json: async () => capabilities() });
  setup();
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Create' })).toHaveProperty('disabled', false);
  });
  get.mockReturnValue({
    json: async () => {
      throw new Error('unavailable');
    },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Simulate denial' }));
  expect(await screen.findByText('Discovery failed')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Create' })).toHaveProperty('disabled', true);
  expect(screen.getByText(/Kubo action denied/)).toBeTruthy();
});

it('starts a new mutation flow disabled even with a previous positive capability', async () => {
  get.mockReturnValue({ json: async () => capabilities() });
  setup();
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Create' })).toHaveProperty('disabled', false);
  });
  get.mockReturnValue({ json: async () => new Promise(jest.fn()) });
  fireEvent.click(screen.getByRole('button', { name: 'Start new flow' }));
  expect(screen.getByRole('button', { name: 'Flow create' })).toHaveProperty('disabled', true);
  await waitFor(() => {
    expect(get).toHaveBeenCalledTimes(2);
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode, useState } from 'react';
import { MemoryRouter } from 'react-router-dom';

import type { EnvTestUtils } from '@/test-utils/env';

import useKuboResource from '../use-kubo-resource';

import Stack from '.';

const navigate = jest.fn();
const deleteRequest = jest.fn();
const patchResponse = jest.fn();
const patchRequest = jest.fn(() => ({ json: patchResponse }));
const access = {
  scope: 'all',
  tenantId: 'a',
  operator: true,
  canMutate: true,
  refresh: jest.fn(async () => true),
  onDenied: jest.fn(async () => {
    await Promise.resolve();
  }),
  isCurrent: () => true,
  path: (path: string) => `${path}${path.includes('?') ? '&' : '?'}scope=all`,
};
afterEach(() => {
  // eslint-disable-next-line @silverhand/fp/no-mutating-assign -- Restore the shared synthetic access fixture even when an assertion fails.
  Object.assign(access, { tenantId: 'a', scope: 'all', operator: true, canMutate: true });
});
jest.mock('../KuboAccess', () => ({ useKuboAccess: () => access }));

jest.mock('@/consts/env', () => jest.requireActual<EnvTestUtils>('@/test-utils/env').mockEnvModule);
jest.mock('../use-kubo-resource', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('react-helmet', () => ({ Helmet: () => null }));
jest.mock('@/components/RequestDataError', () => ({ __esModule: true, default: () => null }));
jest.mock('@/ds-components/Card', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/ds-components/CardTitle', () => ({ __esModule: true, default: () => null }));
jest.mock('@/ds-components/Table', () => ({ __esModule: true, default: () => null }));
jest.mock('@/ds-components/Tag', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
jest.mock('@/ds-components/Select', () => ({ __esModule: true, default: () => null }));
jest.mock('@/ds-components/Checkbox', () => ({
  __esModule: true,
  default: ({
    label,
    checked,
    onChange,
  }: {
    label: ReactNode;
    checked: boolean;
    onChange: (checked: boolean) => void;
  }) => (
    <label>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          onChange(event.currentTarget.checked);
        }}
      />
      {label}
    </label>
  ),
}));
jest.mock('@/ds-components/DeleteConfirmModal', () => {
  function MockDeleteConfirmModal({
    expectedInput,
    inputPlaceholder,
    children,
    onCancel,
    onConfirm,
  }: {
    readonly expectedInput?: string;
    readonly inputPlaceholder?: string;
    readonly children: ReactNode;
    readonly onCancel: () => void;
    readonly onConfirm: () => void;
  }) {
    const [input, setInput] = useState('');
    return (
      <div>
        {children}
        <input
          placeholder={inputPlaceholder}
          value={input}
          onChange={(event) => {
            setInput(event.currentTarget.value);
          }}
        />
        <button type="button" onClick={onCancel}>
          general.cancel
        </button>
        <button type="button" disabled={input !== expectedInput} onClick={onConfirm}>
          general.delete
        </button>
      </div>
    );
  }

  return { __esModule: true, default: MockDeleteConfirmModal };
});
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => navigate,
  useParams: () => ({ namespace: 'team-a', name: 'foundation' }),
}));
jest.mock('@/hooks/use-api', () => ({
  __esModule: true,
  default: () => ({ delete: deleteRequest, patch: patchRequest, post: jest.fn() }),
}));
jest.mock('@/ds-components/Button', () => ({
  __esModule: true,
  default: ({
    title,
    disabled,
    onClick,
  }: {
    title?: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {title}
    </button>
  ),
}));

const stack = {
  namespace: 'team-a',
  name: 'foundation',
  mode: 'Direct',
  phase: 'Ready',
  ready: 1,
  total: 1,
  url: 'https://team-a.meshx.foundation',
  componentValues: {
    'v1-api': { config: { V1_PUBLIC_URL: 'https://v1.meshx.foundation/v1' } },
    'v1-apps': { config: { V1_APPS_URL: 'https://v1-apps.meshx.foundation/apps' } },
  },
  components: [],
};

type MockStack = Omit<typeof stack, 'componentValues' | 'components'> & {
  consoleTenantId?: string;
  componentValues?: Record<string, { config?: Record<string, unknown> }>;
  failing?: string[];
  components: Array<{ name: string; phase: string; message?: string }>;
  operators?: Record<string, boolean>;
};

const renderStack = (data: MockStack = stack) => {
  jest.mocked(useKuboResource).mockReturnValue({
    data,
    error: undefined,
    isLoading: false,
    mutate: jest.fn(async () => data),
  } as unknown as ReturnType<typeof useKuboResource>);
  return render(
    <MemoryRouter>
      <Stack />
    </MemoryRouter>
  );
};

const openDeleteModal = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Delete stack' }));
  await screen.findByPlaceholderText('team-a');
};

const editBundle = async () => {
  fireEvent.click(screen.getByText('Deployment settings'));
  fireEvent.click(screen.getAllByRole('button', { name: 'general.edit' })[0]!);
  fireEvent.change(await screen.findByPlaceholderText('oci://… (empty clears the bundle)'), {
    target: { value: 'oci://registry.example.com/bundle:2' },
  });
};

describe('Kubo stack deletion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    deleteRequest.mockResolvedValue({});
  });

  it('blocks target actions until matching current-tenant ownership is verified', () => {
    // eslint-disable-next-line @silverhand/fp/no-mutating-assign -- Change the synthetic access fixture, not production state.
    Object.assign(access, { operator: false });
    renderStack();
    expect(screen.getByRole('button', { name: 'Delete stack' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'tabs.run_bootstrap' })).toHaveProperty(
      'disabled',
      true
    );
    // eslint-disable-next-line @silverhand/fp/no-mutating-assign -- Restore the synthetic access fixture.
    Object.assign(access, { operator: true });
  });

  it('requires the exact namespace and deletes without purging by default', async () => {
    renderStack();
    await openDeleteModal();

    const confirm = screen.getByRole('button', { name: 'general.delete' });
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByPlaceholderText('team-a'), { target: { value: 'team' } });
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByPlaceholderText('team-a'), { target: { value: 'team-a' } });
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(deleteRequest).toHaveBeenCalledWith(
        'api/kubo/stacks/team-a/foundation?purge=false&scope=all'
      );
    });
    // The tenant-aware navigate prefixes the OSS console segment.
    expect(navigate).toHaveBeenCalledWith('/console/infrastructure', { replace: true });
  });

  it('keeps the modal open and reports a deletion failure', async () => {
    deleteRequest.mockRejectedValue(new Error('Deletion blocked'));
    renderStack();
    await openDeleteModal();
    fireEvent.change(screen.getByPlaceholderText('team-a'), { target: { value: 'team-a' } });
    fireEvent.click(screen.getByRole('button', { name: 'general.delete' }));

    expect(await screen.findByText('Deletion blocked')).toBeTruthy();
    expect(screen.getByPlaceholderText('team-a')).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('resets confirmation and purge state when reopened', async () => {
    renderStack();
    await openDeleteModal();
    fireEvent.change(screen.getByPlaceholderText('team-a'), { target: { value: 'team-a' } });
    fireEvent.click(screen.getByRole('button', { name: 'general.cancel' }));
    await openDeleteModal();

    expect(screen.getByPlaceholderText('team-a')).toHaveProperty('value', '');
    expect(screen.queryByLabelText(/also delete the namespace/i)).toBeNull();
  });

  it('does not offer namespace purge, even in operator view', async () => {
    renderStack();
    await openDeleteModal();
    expect(screen.queryByLabelText(/also delete the namespace/i)).toBeNull();
    expect(screen.getByText(/Namespace purge or reassignment requires/)).toBeTruthy();
    expect(deleteRequest).not.toHaveBeenCalled();
  });
});

describe('Kubo stack environment links', () => {
  it('shows the configured builder and renderer URLs near the stack title', () => {
    renderStack();

    expect(screen.getByRole('link', { name: /Builder.*v1\.meshx\.foundation\/v1/ })).toHaveProperty(
      'href',
      'https://v1.meshx.foundation/v1'
    );
    expect(
      screen.getByRole('link', { name: /Renderer.*v1-apps\.meshx\.foundation\/apps/ })
    ).toHaveProperty('href', 'https://v1-apps.meshx.foundation/apps');
  });

  it('falls back to the stack URL when no app-specific URLs are configured', () => {
    renderStack({ ...stack, componentValues: {} });

    expect(
      screen.getByRole('link', { name: /Environment.*team-a\.meshx\.foundation/ })
    ).toHaveProperty('href', 'https://team-a.meshx.foundation/');
  });

  it('does not render non-web URLs as links', () => {
    renderStack({ ...stack, componentValues: {}, url: 'ftp://team-a.meshx.foundation' });

    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('Kubo stack overview', () => {
  it('shows health and components before the collapsed configuration groups', () => {
    renderStack({
      ...stack,
      phase: 'Progressing',
      ready: 1,
      total: 3,
      failing: ['database'],
      components: [
        { name: 'api', phase: 'Ready' },
        { name: 'database', phase: 'Failed', message: 'Waiting for storage' },
        { name: 'worker', phase: 'Progressing', message: 'Starting containers' },
      ],
    });

    const health = screen.getByRole('region', { name: 'Stack health' });
    const components = screen.getByRole('region', { name: 'Components' });
    const deployment = screen.getByText('Deployment settings').closest('details');
    expect(health.textContent).toContain('Waiting for storage');
    expect(health.textContent).toContain('Starting containers');
    expect(health.textContent).not.toContain('api');
    expect(health.compareDocumentPosition(components)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(deployment).not.toBeNull();
    expect(deployment?.open).toBe(false);
    expect(components.compareDocumentPosition(deployment!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByText('Version and feature overrides').closest('details')?.open).toBe(false);
  });

  it('does not invent a diagnosis when component status is unavailable', () => {
    renderStack({ ...stack, phase: 'Progressing', ready: 0, total: 2 });
    expect(screen.getByRole('region', { name: 'Stack health' }).textContent).toContain(
      'Component status is not available yet.'
    );
    expect(screen.queryByText('All components are ready.')).toBeNull();
  });

  it('confirms readiness when the aggregate and component statuses agree', () => {
    renderStack({ ...stack, components: [{ name: 'api', phase: 'Ready' }] });
    expect(screen.getByRole('region', { name: 'Stack health' }).textContent).toContain(
      'All components are ready.'
    );
  });

  it('does not label an empty stack healthy', () => {
    renderStack({ ...stack, ready: 0, total: 0 });
    expect(screen.queryByText('All components are ready.')).toBeNull();
    expect(screen.getByRole('region', { name: 'Stack health' }).textContent).toContain(
      'Component status is not available yet.'
    );
  });

  it('retains a failing component even when the aggregate says all are ready', () => {
    renderStack({
      ...stack,
      components: [{ name: 'api', phase: 'Failed', message: 'Health check failed' }],
    });
    expect(screen.queryByText('All components are ready.')).toBeNull();
    expect(screen.getByRole('region', { name: 'Stack health' }).textContent).toContain(
      'Health check failed'
    );
  });

  it('separates deletion from operational actions and gives operators readable states', () => {
    renderStack({ ...stack, operators: { vault: true, postgres: false } });
    const danger = screen.getByRole('region', { name: 'Danger zone' });
    expect(danger.contains(screen.getByRole('button', { name: 'Delete stack' }))).toBe(true);
    expect(danger.contains(screen.getByRole('button', { name: 'tabs.run_bootstrap' }))).toBe(false);
    expect(screen.getByText('vault').parentElement?.textContent).toContain('Enabled');
    expect(screen.getByText('postgres').parentElement?.textContent).toContain('Disabled');
  });
});

describe('Kubo grouped configuration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    patchResponse.mockResolvedValue({});
  });

  it('saves only the edited field and closes its editor after saving', async () => {
    renderStack();
    await editBundle();
    fireEvent.click(screen.getByRole('button', { name: 'general.save' }));
    await waitFor(() => {
      expect(patchRequest).toHaveBeenCalledWith('api/kubo/stacks/team-a/foundation?scope=all', {
        json: { bundle: 'oci://registry.example.com/bundle:2' },
      });
      expect(screen.queryByPlaceholderText('oci://… (empty clears the bundle)')).toBeNull();
    });
  });

  it('keeps the draft and shows a save failure without changing other settings', async () => {
    patchResponse.mockRejectedValue(new Error('Save blocked'));
    renderStack();
    await editBundle();
    fireEvent.click(screen.getByRole('button', { name: 'general.save' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Save blocked');
    expect(screen.getByPlaceholderText('oci://… (empty clears the bundle)')).toHaveProperty(
      'value',
      'oci://registry.example.com/bundle:2'
    );
  });

  it('cancels without making a request', async () => {
    renderStack();
    await editBundle();
    fireEvent.click(screen.getByRole('button', { name: 'general.cancel' }));
    expect(patchRequest).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText('oci://… (empty clears the bundle)')).toBeNull();
  });
});

describe('Kubo tenant action boundaries', () => {
  it('keeps read-only detail visible without enabling target actions', () => {
    // eslint-disable-next-line @silverhand/fp/no-mutating-assign -- Synthetic read-only capability response.
    Object.assign(access, { operator: false, scope: 'tenant', canMutate: false });
    renderStack({ ...stack, consoleTenantId: 'a' });
    expect(screen.getByRole('button', { name: 'Delete stack' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'tabs.run_bootstrap' })).toHaveProperty(
      'disabled',
      true
    );
    expect(
      screen
        .getAllByRole('button', { name: 'general.edit' })
        .every((button) => button.hasAttribute('disabled'))
    ).toBe(true);
  });

  it('requires matching B ownership after switching tenants and closes A drafts', async () => {
    const { rerender } = renderStack({ ...stack, consoleTenantId: 'a' });
    await editBundle();
    // eslint-disable-next-line @silverhand/fp/no-mutating-assign -- Simulate an A-to-B context switch before B detail arrives.
    Object.assign(access, { tenantId: 'b', operator: false, scope: 'tenant' });
    rerender(
      <MemoryRouter>
        <Stack />
      </MemoryRouter>
    );
    expect(screen.queryByPlaceholderText('oci://… (empty clears the bundle)')).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete stack' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'tabs.run_bootstrap' })).toHaveProperty(
      'disabled',
      true
    );
  });

  it('exposes only excludes and boolean feature-flag editors in tenant view', () => {
    // eslint-disable-next-line @silverhand/fp/no-mutating-assign -- Synthetic ordinary tenant capability response.
    Object.assign(access, { operator: false, scope: 'tenant' });
    renderStack({ ...stack, consoleTenantId: 'a' });
    expect(
      screen
        .getAllByRole('button', { name: 'general.edit' })
        .filter((button) => !button.hasAttribute('disabled'))
    ).toHaveLength(2);
  });
});

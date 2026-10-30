import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode, useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import useSWR from 'swr';

import type { EnvTestUtils } from '@/test-utils/env';

import Stack from '.';

const navigate = jest.fn();
const deleteRequest = jest.fn();

jest.mock('@/consts/env', () => jest.requireActual<EnvTestUtils>('@/test-utils/env').mockEnvModule);
jest.mock('swr', () => ({ __esModule: true, default: jest.fn() }));
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
  default: () => ({ delete: deleteRequest, patch: jest.fn(), post: jest.fn() }),
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

type MockStack = Omit<typeof stack, 'componentValues'> & {
  componentValues?: Record<string, { config?: Record<string, unknown> }>;
};

const renderStack = (data: MockStack = stack) => {
  jest.mocked(useSWR).mockReturnValue({
    data,
    error: undefined,
    isLoading: false,
    mutate: jest.fn(),
  } as unknown as ReturnType<typeof useSWR>);
  return render(
    <MemoryRouter>
      <Stack />
    </MemoryRouter>
  );
};

const openDeleteModal = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Delete stack' }));
};

describe('Kubo stack deletion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    deleteRequest.mockResolvedValue({});
  });

  it('requires the exact namespace and deletes without purging by default', async () => {
    renderStack();
    openDeleteModal();

    const confirm = screen.getByRole('button', { name: 'general.delete' });
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByPlaceholderText('team-a'), { target: { value: 'team' } });
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByPlaceholderText('team-a'), { target: { value: 'team-a' } });
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(deleteRequest).toHaveBeenCalledWith('api/kubo/stacks/team-a/foundation?purge=false');
    });
    // The tenant-aware navigate prefixes the OSS console segment.
    expect(navigate).toHaveBeenCalledWith('/console/infrastructure', { replace: true });
  });

  it('keeps the modal open and reports a deletion failure', async () => {
    deleteRequest.mockRejectedValue(new Error('Deletion blocked'));
    renderStack();
    openDeleteModal();
    fireEvent.change(screen.getByPlaceholderText('team-a'), { target: { value: 'team-a' } });
    fireEvent.click(screen.getByRole('button', { name: 'general.delete' }));

    expect(await screen.findByText('Deletion blocked')).toBeTruthy();
    expect(screen.getByPlaceholderText('team-a')).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('resets confirmation and purge state when reopened', () => {
    renderStack();
    openDeleteModal();
    fireEvent.change(screen.getByPlaceholderText('team-a'), { target: { value: 'team-a' } });
    fireEvent.click(screen.getByLabelText(/also delete the namespace/i));
    fireEvent.click(screen.getByRole('button', { name: 'general.cancel' }));
    openDeleteModal();

    expect(screen.getByPlaceholderText('team-a')).toHaveProperty('value', '');
    expect(screen.getByLabelText(/also delete the namespace/i)).toHaveProperty('checked', false);
  });

  it('does not delete when the namespace purge warning is cancelled', () => {
    jest.spyOn(window, 'confirm').mockReturnValue(false);
    renderStack();
    openDeleteModal();
    fireEvent.change(screen.getByPlaceholderText('team-a'), { target: { value: 'team-a' } });
    fireEvent.click(screen.getByLabelText(/also delete the namespace/i));
    fireEvent.click(screen.getByRole('button', { name: 'general.delete' }));

    expect(window.confirm).toHaveBeenCalledWith(
      'Deleting namespace "team-a" removes everything in it, not just this stack. Continue?'
    );
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

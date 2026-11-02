import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { SWRConfig } from 'swr';

import useKuboResource, { KuboSessionContext } from './use-kubo-resource';

const get = jest.fn();
jest.mock('@/hooks/use-api', () => ({ __esModule: true, default: () => ({ get }) }));

function deferred<T>() {
  const deferred = { resolve: (_value: T) => undefined as void };
  const promise = new Promise<T>((resolve) => {
    // eslint-disable-next-line @silverhand/fp/no-mutating-assign -- Capture the deferred fixture resolver.
    Object.assign(deferred, { resolve });
  });
  return {
    promise,
    resolve: (value: T) => {
      deferred.resolve(value);
    },
  };
}

const setup = () => {
  const cache = new Map();
  const context = { tenantId: 'a', identity: 'actor-session-a' };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>
      <KuboSessionContext.Provider value={{ ...context }}>{children}</KuboSessionContext.Provider>
    </SWRConfig>
  );
  const hook = renderHook(
    ({ scope }: { tenant: string; scope: 'tenant' | 'all' }) =>
      useKuboResource<{ name: string }>('api/kubo/stacks', scope),
    { wrapper, initialProps: { tenant: 'a', scope: 'tenant' } }
  );
  return {
    ...hook,
    rerender: (props: { tenant: string; scope: 'tenant' | 'all'; identity?: string }) => {
      // eslint-disable-next-line @silverhand/fp/no-mutating-assign -- Simulate a context switch in the hook wrapper.
      Object.assign(context, {
        tenantId: props.tenant,
        identity: props.identity ?? context.identity,
      });
      hook.rerender(props);
    },
  };
};

beforeEach(() => {
  get.mockReset();
});

it('isolates authenticated sessions even within the same tenant and scope', async () => {
  const old = deferred<{ name: string }>();
  get
    .mockReturnValueOnce({ json: async () => old.promise })
    .mockReturnValueOnce({ json: async () => ({ name: 'new-actor' }) });
  const { result, rerender } = setup();
  await waitFor(() => {
    expect(get).toHaveBeenCalledTimes(1);
  });
  rerender({ tenant: 'a', scope: 'tenant', identity: 'different-session' });
  expect(result.current.data).toBeUndefined();
  await waitFor(() => {
    expect(result.current.data?.name).toBe('new-actor');
  });
  await act(async () => {
    old.resolve({ name: 'old-actor-secret' });
  });
  expect(result.current.data?.name).toBe('new-actor');
});

it('clears A immediately on a tenant switch and ignores a late A response', async () => {
  const first = deferred<{ name: string }>();
  const second = deferred<{ name: string }>();
  get
    .mockReturnValueOnce({ json: async () => first.promise })
    .mockReturnValueOnce({ json: async () => second.promise });
  const { result, rerender } = setup();
  await waitFor(() => {
    expect(get).toHaveBeenCalledTimes(1);
  });
  rerender({ tenant: 'b', scope: 'tenant' });
  expect(result.current.data).toBeUndefined();
  await waitFor(() => {
    expect(get).toHaveBeenCalledTimes(2);
  });
  await act(async () => {
    first.resolve({ name: 'secret-a' });
  });
  expect(result.current.data).toBeUndefined();
  await act(async () => {
    second.resolve({ name: 'owned-b' });
  });
  await waitFor(() => {
    expect(result.current.data?.name).toBe('owned-b');
  });
});

it('never keeps previous tenant or scope data', async () => {
  get.mockReturnValue({ json: async () => ({ name: 'secret-a' }) });
  const { result, rerender } = setup();
  await waitFor(() => {
    expect(result.current.data?.name).toBe('secret-a');
  });
  get.mockReturnValue({ json: async () => new Promise(jest.fn()) });
  rerender({ tenant: 'b', scope: 'tenant' });
  expect(result.current.data).toBeUndefined();
  rerender({ tenant: 'b', scope: 'all' });
  expect(result.current.data).toBeUndefined();
  await waitFor(() => {
    expect(get).toHaveBeenCalledWith('api/kubo/stacks?scope=all');
  });
});

import { defaultLandingPageContent } from '@logto/schemas';
import { act, renderHook, waitFor } from '@testing-library/react';

import { type ProposedAction } from './ProposedActionCard';
import useChatActionReviews from './use-chat-action-reviews';

const action: ProposedAction = {
  id: 'original',
  tool: 'save_landing_page_draft',
  body: defaultLandingPageContent,
  expiresAt: new Date(Date.now() - 1000).toISOString(),
  status: 'pending',
};
const deferred = () => {
  const release = jest.fn<void, [unknown]>();
  const promise = new Promise<unknown>((resolve) => {
    release.mockImplementation(resolve);
  });
  return { promise, release };
};
const options = () => ({
  confirm: jest.fn(async (_id: string) => ({})),
  cancel: jest.fn(async (_id: string): Promise<unknown> => ({})),
  refresh: jest.fn(async (_action: ProposedAction) => ({
    ...action,
    id: 'fresh',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  })),
  refreshEditor: jest.fn(async () => ({})),
  failureMessage: 'Could not save',
});

it('blocks refresh while cancellation is pending so a discarded review cannot be resurrected', async () => {
  const request = deferred();
  const api = options();
  api.cancel.mockImplementation(async () => request.promise);
  const { result } = renderHook(() => useChatActionReviews(api));
  act(() => {
    result.current.onCancel(action.id);
  });
  await act(async () => {
    await result.current.onRefresh(action);
  });
  expect(api.refresh).not.toHaveBeenCalled();
  expect(result.current.statuses.original?.operation).toBe('cancel');
  await act(async () => {
    request.release({});
  });
  await waitFor(() => {
    expect(result.current.statuses.original?.status).toBe('cancelled');
  });
});

it('blocks cancellation while refreshing and only exposes the returned replacement', async () => {
  const request = deferred();
  const api = options();
  api.refresh.mockImplementation(async () => (await request.promise) as ProposedAction);
  const { result } = renderHook(() => useChatActionReviews(api));
  const complete = { promise: Promise.resolve() };
  act(() => {
    // eslint-disable-next-line @silverhand/fp/no-mutation -- Capture the pending refresh without waiting, so the test can race a cancellation against it.
    complete.promise = result.current.onRefresh(action);
    result.current.onCancel(action.id);
  });
  expect(api.cancel).not.toHaveBeenCalled();
  await act(async () => {
    request.release({ ...action, id: 'fresh' });
    await complete.promise;
  });
  expect(result.current.statuses.original?.replacement?.id).toBe('fresh');
  expect(result.current.statuses.original?.status).toBe('pending');
});

it('confirms the latest ID after repeated refreshes and ignores stale callbacks', async () => {
  const api = options();
  const { result } = renderHook(() => useChatActionReviews(api));
  await act(async () => {
    await result.current.onRefresh(action);
  });
  const fresh = result.current.statuses.original?.replacement;
  if (!fresh) {
    throw new Error('Missing refreshed proposal');
  }
  api.refresh.mockResolvedValueOnce({ ...fresh, id: 'newest' });
  await act(async () => {
    await result.current.onRefresh(fresh, action.id);
  });
  act(() => {
    result.current.onConfirm(action, action.id);
  });
  expect(api.confirm).not.toHaveBeenCalled();
  const newest = result.current.statuses.original?.replacement;
  if (!newest) {
    throw new Error('Missing latest proposal');
  }
  act(() => {
    result.current.onConfirm(newest, action.id);
  });
  await waitFor(() => {
    expect(result.current.statuses.original?.status).toBe('done');
  });
  expect(api.confirm).toHaveBeenCalledWith('newest');
  expect(api.refreshEditor).toHaveBeenCalledTimes(1);
});

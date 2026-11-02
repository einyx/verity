import { act, renderHook, waitFor } from '@testing-library/react';

import { type SessionApi } from './session-api';
import useChatSessions from './use-chat-sessions';

it('identity changes immediately hide previous history and cleanup late account requests', async () => {
  const api = {
    list: jest.fn(async () => ({ items: [], nextCursor: null })),
  } as unknown as SessionApi;
  const { result, rerender } = renderHook(
    ({ userId }) => useChatSessions({ scope: { tenantId: 'tenant', userId }, api, visible: false }),
    { initialProps: { userId: 'one' } }
  );
  await waitFor(() => {
    expect(result.current.controller).toBeDefined();
  });
  const old = result.current.controller;
  act(() => {
    rerender({ userId: 'two' });
  });
  expect(result.current.controller).not.toBe(old);
  expect(old?.getSnapshot().records).toEqual({});
});

it('refreshing the authenticated API client does not discard an unsaved account draft', async () => {
  const first = { list: jest.fn() } as unknown as SessionApi;
  const second = { list: jest.fn() } as unknown as SessionApi;
  const { result, rerender } = renderHook(
    ({ api }) =>
      useChatSessions({ scope: { tenantId: 'tenant', userId: 'owner' }, api, visible: false }),
    { initialProps: { api: first } }
  );
  await waitFor(() => {
    expect(result.current.controller).toBeDefined();
  });
  const original = result.current.controller;
  act(() => {
    original?.setText('Not yet acknowledged');
  });
  rerender({ api: second });
  expect(result.current.controller).toBe(original);
  expect(result.current.state.emptyDraft.text).toBe('Not yet acknowledged');
});

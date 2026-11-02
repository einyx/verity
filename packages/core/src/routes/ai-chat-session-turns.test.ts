import { type ChatTurn, chatLeaseHeartbeatMs } from '@logto/schemas';

import { type ChatSessionStore } from './ai-chat-session-store.js';
import { deferred } from './ai-chat-session-turn-safety.test-helper.js';
import { type ChatTurnStore } from './ai-chat-session-turn-store.js';
import { runSessionTurn } from './ai-chat-session-turns.js';

const { jest } = import.meta;
afterEach(() => {
  jest.useRealTimers();
});

it.each([false, true])('heartbeat cleanup after long work; failure=%s', async (fails) => {
  jest.useFakeTimers();
  const entered = deferred();
  const release = deferred();
  const turn: ChatTurn = {
    id: 'turn',
    requestId: '10000000-0000-4000-8000-000000000000',
    state: 'running',
    errorCode: null,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    completedAt: null,
    messageIds: [],
  };
  const heartbeat = jest.fn(async () => {
    if (fails) {
      throw new Error('Lost database connection');
    }
  });
  const turns: ChatTurnStore = {
    claim: async () => ({ kind: 'claimed', turn, leaseToken: 'private' }),
    heartbeat,
    assertOwned: async () => {
      /* Active ownership. */
    },
    complete: async () => {
      throw new Error('Must not complete');
    },
    fail: async () => ({ ...turn, state: 'failed', errorCode: 'ai_chat_unavailable' }),
    get: async () => turn,
  };
  const sessions: Pick<ChatSessionStore, 'messages'> = {
    messages: async () => ({ items: [], nextCursor: null }),
  };
  const running = runSessionTurn({
    scope: { tenantId: 'tenant', userId: 'user' },
    sessionId: 'session',
    input: {
      requestId: turn.requestId,
      composerRevision: 0,
      expectedTranscriptRevision: 0,
      text: 'hello',
      attachments: [],
    },
    credentials: { apiKey: 'memory-only' },
    store: {
      turns,
      sessions,
      propose: () => ({
        insert: async () => {
          /* No proposals. */
        },
      }),
    },
    runner: async () => {
      entered.resolve();
      await release.promise;
      throw new Error('raw secret/tool trace');
    },
  });
  await entered.promise;
  await jest.advanceTimersByTimeAsync(chatLeaseHeartbeatMs * 2);
  expect(heartbeat).toHaveBeenCalledTimes(2);
  release.resolve();
  if (fails) {
    await expect(running).rejects.toMatchObject({ code: 'session_busy' });
  } else {
    expect(await running).toMatchObject({ state: 'failed', errorCode: 'ai_chat_unavailable' });
  }
  await jest.advanceTimersByTimeAsync(chatLeaseHeartbeatMs * 2);
  expect(heartbeat).toHaveBeenCalledTimes(2);
  expect(jest.getTimerCount()).toBe(0);
});

import {
  type ChatScope,
  type ChatTurn,
  type CreateTurnInput,
  chatLeaseHeartbeatMs,
} from '@logto/schemas';

import { type PendingActionStore } from './ai-chat-actions.js';
import { type ModelMessage } from './ai-chat-loop.js';
import { ChatSessionStoreError } from './ai-chat-session-operation.js';
import { type ChatSessionStore } from './ai-chat-session-store.js';
import { type ChatTurnStore } from './ai-chat-session-turn-store.js';

export type SessionRunner = (options: {
  messages: ModelMessage[];
  credentials: { apiKey: string };
  propose: Pick<PendingActionStore, 'insert'>;
  assertActive: () => Promise<void>;
}) => Promise<{ ok: boolean; content: string }>;

export const runSessionTurn = async (options: {
  scope: ChatScope;
  sessionId: string;
  input: CreateTurnInput;
  credentials: { apiKey: string };
  store: {
    turns: ChatTurnStore;
    sessions: Pick<ChatSessionStore, 'messages'>;
    propose: (turnId: string, leaseToken: string) => Pick<PendingActionStore, 'insert'>;
  };
  runner: SessionRunner;
}): Promise<ChatTurn> => {
  const { scope, sessionId, input, credentials, store, runner } = options;
  if (!credentials.apiKey) {
    throw new ChatSessionStoreError('ai_chat_not_configured');
  }
  const claim = await store.turns.claim(scope, sessionId, input);
  if (claim.kind === 'error') {
    throw new ChatSessionStoreError(claim.error.error, claim.error.currentRevision);
  }
  if (claim.kind === 'existing') {
    return claim.turn;
  }
  const { turn, leaseToken } = claim;
  const lost = new AbortController();
  const pending = new Set<Promise<void>>();
  const heartbeat = setInterval(() => {
    const work = (async () => {
      try {
        await store.turns.heartbeat(scope, sessionId, turn.id, leaseToken);
      } catch (error) {
        lost.abort(error);
      }
    })();
    pending.add(work);
    void (async () => {
      await work;
      pending.delete(work);
    })();
  }, chatLeaseHeartbeatMs);
  const assertActive = async () => {
    if (lost.signal.aborted) {
      throw new ChatSessionStoreError('session_busy');
    }
    await store.turns.assertOwned(scope, sessionId, turn.id, leaseToken);
  };
  const proposalIds = new Set<string>();
  try {
    const proposalStore = store.propose(turn.id, leaseToken);
    await assertActive();
    const page = await store.sessions.messages(scope, sessionId);
    const omitted = Boolean(page.nextCursor) || page.items.length > 40;
    const messages: ModelMessage[] = [
      ...(omitted
        ? [
            {
              role: 'system' as const,
              content: 'Older history was omitted from this bounded context.',
            },
          ]
        : []),
      ...page.items.slice(-40).map(({ role, content }) => ({ role, content })),
    ];
    const result = await runner({
      messages,
      credentials,
      assertActive,
      propose: {
        insert: async (action, sourceArgs) => {
          await proposalStore.insert(action, sourceArgs);
          proposalIds.add(action.id);
        },
      },
    });
    await assertActive();
    if (!result.ok) {
      return await store.turns.fail(scope, sessionId, turn.id, leaseToken, 'ai_chat_unavailable');
    }
    return await store.turns.complete(scope, sessionId, turn.id, leaseToken, {
      content: omitted
        ? `Older history was omitted from the model context.\n\n${result.content}`
        : result.content,
      proposalIds: [...proposalIds],
    });
  } catch (error) {
    await assertActive();
    return await store.turns.fail(
      scope,
      sessionId,
      turn.id,
      leaseToken,
      error instanceof ChatSessionStoreError && error.code === 'content_limit'
        ? 'content_limit'
        : 'ai_chat_unavailable'
    );
  } finally {
    clearInterval(heartbeat);
    await Promise.all(pending);
  }
};

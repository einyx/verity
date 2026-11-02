import {
  type ChatScope,
  type ChatReview,
  chatReviewGuard,
  chatSessionMaxStoredBytes,
} from '@logto/schemas';
import { generateStandardId } from '@logto/shared';
import { type DatabasePool, type DatabaseTransactionConnection, sql } from '@silverhand/slonik';
import { z } from 'zod/v3';

import {
  createPendingActionStore,
  type PendingActionStore,
  type PendingAction,
  pendingActionTtlMs,
  landingDraftReviewTtlMs,
} from './ai-chat-actions.js';
import {
  claimActionLease,
  releaseActionLease,
  runWithActionLease,
} from './ai-chat-session-action-lease.js';
import { ChatSessionStoreError, reconcileOperation } from './ai-chat-session-operation.js';
import { validateStoredReview } from './ai-chat-session-review-validation.js';
import {
  lockTurnSession,
  serverTime,
  turnWhere,
  sessionWhere,
} from './ai-chat-session-turn-persistence.js';

const reviewLinkGuard = z.object({
  id: z.string(),
  session_id: z.string().nullable(),
  message_id: z.string().nullable(),
  original_action_id: z.string(),
  current_action_id: z.string(),
});
type ReviewLink = z.infer<typeof reviewLinkGuard>;
type ActionOperation = {
  kind: 'confirm' | 'cancel';
  sessionId?: string;
  originalActionId?: string;
};
const linkWhere = (scope: ChatScope) =>
  sql`tenant_id = ${scope.tenantId} and user_id = ${scope.userId}`;
const readLink = async (
  connection: DatabaseTransactionConnection,
  scope: ChatScope,
  actionId: string
) =>
  connection.maybeOne<ReviewLink>(sql`select id, session_id, message_id, original_action_id, current_action_id
    from ai_chat_review_links where ${linkWhere(scope)}
      and (original_action_id = ${actionId} or current_action_id = ${actionId}
        or ${actionId} = any(previous_action_ids))`);

const review = (link: ReviewLink, action: PendingAction, now: string): ChatReview =>
  chatReviewGuard.parse({
    originalActionId: link.original_action_id,
    currentActionId: link.current_action_id,
    tool: action.tool,
    body: action.body,
    expiresAt: new Date(action.expiresAt).toISOString(),
    state:
      action.state === 'pending' && new Date(action.expiresAt).getTime() <= Date.parse(now)
        ? 'expired'
        : action.state,
    isError:
      action.result &&
      typeof action.result === 'object' &&
      'isError' in action.result &&
      typeof action.result.isError === 'boolean'
        ? action.result.isError
        : null,
  });

const checkLinkScope = (link: ReviewLink, operation: ActionOperation) => {
  if (operation.sessionId !== undefined && link.session_id !== operation.sessionId) {
    throw new ChatSessionStoreError('not_found');
  }
  if (
    operation.originalActionId !== undefined &&
    link.original_action_id !== operation.originalActionId
  ) {
    throw new ChatSessionStoreError('not_found');
  }
};

const lockLinkedAction = async (
  connection: DatabaseTransactionConnection,
  scope: ChatScope,
  actionId: string,
  operation: ActionOperation
) => {
  // Lookup is not a lock: lifecycle/refresh may win before the session serialization point.
  const initial = await readLink(connection, scope, actionId);
  if (!initial) {
    if (operation.sessionId) {
      throw new ChatSessionStoreError('not_found');
    }
    return;
  }
  if (!initial.session_id || !initial.message_id) {
    throw new ChatSessionStoreError('not_found');
  }
  checkLinkScope(initial, operation);
  const session = await lockTurnSession(connection, scope, initial.session_id);
  const link = await readLink(connection, scope, actionId);
  if (!link?.session_id || !link.message_id) {
    throw new ChatSessionStoreError('not_found');
  }
  if (session.archived) {
    throw new ChatSessionStoreError('session_archived');
  }
  if (link.current_action_id !== actionId) {
    throw new ChatSessionStoreError('review_replaced');
  }
  return { link, session, sessionId: link.session_id };
};

export const createSessionActionStore = (pool: DatabasePool) => ({
  getSessionReviews: async (scope: ChatScope, sessionId: string): Promise<ChatReview[]> =>
    pool.transaction(async (connection) => {
      await lockTurnSession(connection, scope, sessionId);
      const now = await serverTime(connection);
      const links = await connection.any<ReviewLink>(sql`
        select id, session_id, message_id, original_action_id, current_action_id
        from ai_chat_review_links where ${turnWhere(scope, sessionId)} and message_id is not null order by id`);
      return Promise.all(
        links.map(async (link) => {
          const action = await createPendingActionStore(connection).findById(
            link.current_action_id,
            scope.tenantId
          );
          if (!action || action.userId !== scope.userId) {
            throw new ChatSessionStoreError('not_found');
          }
          return review(link, action, now);
        })
      );
    }),
  refreshSessionReview: async (
    scope: ChatScope,
    sessionId: string,
    originalActionId: string,
    expectedActionId: string
  ): Promise<ChatReview> =>
    pool.transaction(async (connection) => {
      const locked = await lockLinkedAction(connection, scope, expectedActionId, {
        kind: 'cancel',
        sessionId,
        originalActionId,
      });
      if (!locked) {
        throw new ChatSessionStoreError('not_found');
      }
      const now = await serverTime(connection);
      await reconcileOperation(connection, scope, sessionId, now);
      const lease = { scope, sessionId, token: generateStandardId() };
      await claimActionLease(connection, lease, now);
      const store = createPendingActionStore(connection);
      const action = await store.findById(expectedActionId, scope.tenantId);
      if (!action || action.userId !== scope.userId) {
        throw new ChatSessionStoreError('not_found');
      }
      if (!['pending', 'expired'].includes(action.state)) {
        throw new ChatSessionStoreError('revision_conflict');
      }
      validateStoredReview(action);
      const bytes = Buffer.byteLength(JSON.stringify(action.body));
      if (locked.session.stored_bytes + bytes > chatSessionMaxStoredBytes) {
        throw new ChatSessionStoreError('content_limit');
      }
      const replacement: PendingAction = {
        ...action,
        id: generateStandardId(),
        state: 'pending',
        result: null,
        expiresAt: new Date(
          Date.parse(now) +
            (action.tool === 'save_landing_page_draft'
              ? landingDraftReviewTtlMs
              : pendingActionTtlMs)
        ),
      };
      await store.insert(replacement);
      // Supersession is terminal even if an old ID is submitted to the legacy API.
      if (action.state === 'pending') {
        await store.setOutcome(
          action.id,
          new Date(action.expiresAt).getTime() <= Date.parse(now) ? 'expired' : 'cancelled',
          null
        );
      }
      await connection.query(sql`update ai_chat_review_links
      set previous_action_ids = array_append(previous_action_ids, current_action_id), current_action_id = ${replacement.id}
      where ${linkWhere(scope)} and id = ${locked.link.id} and current_action_id = ${expectedActionId}`);
      await connection.query(sql`update ai_chat_sessions set stored_bytes = stored_bytes + ${bytes}
      where ${sessionWhere(scope, sessionId)}`);
      await releaseActionLease(connection, lease);
      return review({ ...locked.link, current_action_id: replacement.id }, replacement, now);
    }),
  withSessionActionOperation: async <T>(
    scope: ChatScope,
    actionId: string,
    operation: ActionOperation,
    execute: (store: PendingActionStore, assertActive: () => Promise<void>) => Promise<T>
  ): Promise<T> => {
    const token = generateStandardId();
    const claim = await pool.transaction(async (connection) => {
      const locked = await lockLinkedAction(connection, scope, actionId, operation);
      if (!locked) {
        return { kind: 'unlinked' as const };
      }
      const now = await serverTime(connection);
      await reconcileOperation(connection, scope, locked.sessionId, now);
      const action = await createPendingActionStore(connection).findById(actionId, scope.tenantId);
      if (!action || action.userId !== scope.userId) {
        throw new ChatSessionStoreError('not_found');
      }
      validateStoredReview(action);
      const lease = { scope, sessionId: locked.sessionId, token };
      await claimActionLease(connection, lease, now);
      if (operation.kind === 'cancel') {
        if (action.state === 'pending' && new Date(action.expiresAt).getTime() <= Date.parse(now)) {
          await createPendingActionStore(connection).setOutcome(actionId, 'expired', null);
        }
        const result = await execute(createPendingActionStore(connection), async () => {
          /* Transaction holds the session lock. */
        });
        await releaseActionLease(connection, lease);
        return { kind: 'cancel' as const, result };
      }
      const claimed = await createPendingActionStore(connection).claim(
        actionId,
        scope.tenantId,
        scope.userId,
        new Date(now)
      );
      if (action.state === 'pending' && !claimed) {
        await createPendingActionStore(connection).setOutcome(actionId, 'expired', null);
      }
      return { kind: 'confirm' as const, sessionId: locked.sessionId, claimed, action };
    });
    if (claim.kind === 'cancel') {
      return claim.result;
    }
    const sessionId = claim.kind === 'confirm' ? claim.sessionId : undefined;
    // Commit the lease before any external request. A thrown confirmation retains its uncertain claim.
    const store = createPendingActionStore(pool);
    const result =
      claim.kind === 'confirm'
        ? await runWithActionLease(
            pool,
            { scope, sessionId: claim.sessionId, token },
            async (assertActive) =>
              execute(
                {
                  ...store,
                  claim: async () => claim.claimed,
                  // Keep the legacy expired response while the authoritative row is already terminalized.
                  findById: async (id, tenantId) =>
                    claim.action.state === 'pending' && !claim.claimed
                      ? claim.action
                      : store.findById(id, tenantId),
                },
                assertActive
              )
          )
        : await execute(store, async () => {
            /* Truly unlinked legacy action. */
          });
    if (sessionId) {
      await pool.transaction(async (connection) => {
        await lockTurnSession(connection, scope, sessionId);
        const confirmed = await connection.maybeOne(sql`select id from ai_pending_actions
          where ${linkWhere(scope)} and id = ${actionId} and state = 'confirmed'`);
        if (!confirmed) {
          await releaseActionLease(connection, { scope, sessionId, token });
        }
      });
    }
    return result;
  },
});

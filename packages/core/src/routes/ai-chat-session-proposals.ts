import { type ChatScope, chatSessionMaxStoredBytes } from '@logto/schemas';
import { generateStandardId } from '@logto/shared';
import { type DatabasePool, sql } from '@silverhand/slonik';

import { EnvSet } from '#src/env-set/index.js';

import {
  createPendingActionStore,
  hashBody,
  type PendingActionStore,
  type PendingAction,
} from './ai-chat-actions.js';
import { pendingActionTools, saveLandingPageDraftTool } from './ai-chat-landing-page.js';
import { ChatSessionStoreError } from './ai-chat-session-operation.js';
import {
  lockTurnSession,
  assertTurnLease,
  serverTime,
  sessionWhere,
} from './ai-chat-session-turn-persistence.js';

/** Validate semantics against the authoritative tool registry, not just the JSON-shaped review guard. */
export const validateBody = (action: PendingAction, args?: Record<string, unknown>) => {
  const tool = pendingActionTools(EnvSet.values.isDevFeaturesEnabled).find(
    ({ name }) => name === action.tool
  );
  if (
    !args ||
    !tool?.body ||
    (tool.method !== 'POST' && tool.name !== saveLandingPageDraftTool.name)
  ) {
    throw new ChatSessionStoreError('revision_conflict');
  }
  const valid =
    (tool.required ?? []).every((key) => args[key] !== undefined) &&
    Object.entries(tool.properties).every(([key, property]) => {
      const value = args[key];
      if (value === undefined) {
        return true;
      }
      if (property.type === 'array') {
        return Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');
      }
      if (property.type === 'number') {
        return typeof value === 'number' && Number.isFinite(value);
      }
      return typeof value === 'string' && (!property.enum || property.enum.includes(value));
    });
  try {
    if (
      valid &&
      hashBody(tool.body(args)) === hashBody(action.body) &&
      action.bodyHash === hashBody(action.body)
    ) {
      return;
    }
  } catch {}
  throw new ChatSessionStoreError('revision_conflict');
};

export const createTurnProposalStore = (
  pool: DatabasePool,
  scope: ChatScope,
  sessionId: string,
  turnId: string,
  leaseToken: string
): Pick<PendingActionStore, 'insert'> => ({
  insert: async (action, sourceArgs) =>
    pool.transaction(async (connection) => {
      const session = await lockTurnSession(connection, scope, sessionId);
      if (session.archived) {
        throw new ChatSessionStoreError('session_archived');
      }
      await assertTurnLease(
        connection,
        scope,
        sessionId,
        turnId,
        leaseToken,
        await serverTime(connection)
      );
      if (
        action.tenantId !== scope.tenantId ||
        action.userId !== scope.userId ||
        action.state !== 'pending' ||
        action.result !== null
      ) {
        throw new ChatSessionStoreError('revision_conflict');
      }
      validateBody(action, sourceArgs);
      const bytes = Buffer.byteLength(JSON.stringify(action.body), 'utf8');
      if (session.stored_bytes + bytes > chatSessionMaxStoredBytes) {
        throw new ChatSessionStoreError('content_limit');
      }
      await createPendingActionStore(connection).insert(action);
      await connection.query(sql`insert into ai_chat_review_links
      (id, tenant_id, user_id, session_id, turn_id, message_id, original_action_id, current_action_id)
      values (${generateStandardId()}, ${scope.tenantId}, ${scope.userId}, ${sessionId}, ${turnId}, null, ${action.id}, ${action.id})`);
      await connection.query(sql`update ai_chat_sessions set stored_bytes = stored_bytes + ${bytes}
      where ${sessionWhere(scope, sessionId)}`);
    }),
});

import { randomUUID } from 'node:crypto';

import {
  type ChatScope,
  type ChatTurn,
  type CreateTurnInput,
  type chatSessionErrorGuard,
  chatContentMaxBytes,
  chatSessionMaxMessages,
  chatSessionMaxStoredBytes,
  chatLeaseExpiryMs,
  createTurnInputGuard,
  serializeChatInput,
} from '@logto/schemas';
import { generateStandardId } from '@logto/shared';
import { type DatabasePool, sql } from '@silverhand/slonik';
import { type z } from 'zod/v3';

import {
  ChatSessionStoreError,
  reconcileOperation,
  releaseTurnReservation,
  cancelTurnProposals,
} from './ai-chat-session-operation.js';
import {
  lockTurnSession,
  readTurn,
  turnWhere,
  sessionWhere,
  assertTurnLease,
  serverTime,
  hashTurnInput,
  normalizeTurnResult,
  findExistingTurn,
  reconcileRetry,
} from './ai-chat-session-turn-persistence.js';

export type TurnClaim =
  | { kind: 'claimed'; turn: ChatTurn; leaseToken: string }
  | { kind: 'existing'; turn: ChatTurn }
  | { kind: 'error'; error: z.infer<typeof chatSessionErrorGuard> };
export type ChatTurnStore = {
  claim: (scope: ChatScope, sessionId: string, input: CreateTurnInput) => Promise<TurnClaim>;
  heartbeat: (
    scope: ChatScope,
    sessionId: string,
    turnId: string,
    leaseToken: string
  ) => Promise<void>;
  assertOwned: (
    scope: ChatScope,
    sessionId: string,
    turnId: string,
    leaseToken: string
  ) => Promise<void>;
  complete: (
    scope: ChatScope,
    sessionId: string,
    turnId: string,
    leaseToken: string,
    result: { content: string; proposalIds: string[] }
  ) => Promise<ChatTurn>;
  fail: (
    scope: ChatScope,
    sessionId: string,
    turnId: string,
    leaseToken: string,
    errorCode: string
  ) => Promise<ChatTurn>;
  get: (scope: ChatScope, sessionId: string, requestId?: string) => Promise<ChatTurn | undefined>;
};

export const createChatTurnStore = (
  pool: DatabasePool,
  options?: { clock?: () => Date }
): ChatTurnStore => {
  const finish = async (
    scope: ChatScope,
    sessionId: string,
    turnId: string,
    leaseToken: string,
    result: { content: string; proposalIds: string[] } | { errorCode: string }
  ): Promise<ChatTurn> =>
    pool.transaction(async (connection) => {
      const session = await lockTurnSession(connection, scope, sessionId);
      const now = await serverTime(connection, options?.clock);
      const where = turnWhere(scope, sessionId);
      const turn = await readTurn(connection, scope, sessionId, sql`t.id = ${turnId}`);
      if (!turn) {
        throw new ChatSessionStoreError('not_found');
      }
      const normalized = normalizeTurnResult(result);
      if (turn.state !== 'running') {
        const token = await connection.oneFirst<string | undefined>(
          sql`select lease_token from ai_chat_turns where ${where} and id = ${turnId}`
        );
        if (token === leaseToken && turn.state === normalized.state) {
          return turn;
        }
        throw new ChatSessionStoreError('session_busy');
      }
      await assertTurnLease(connection, scope, sessionId, turnId, leaseToken, now);
      if (session.archived) {
        throw new ChatSessionStoreError('session_archived');
      }
      const { state, errorCode } = normalized;
      await releaseTurnReservation(connection, scope, sessionId, turnId);
      if (normalized.content !== null) {
        const { proposalIds, content } = normalized;
        const links = await connection.any(sql`
        select l.id from ai_chat_review_links l join ai_pending_actions a
          on a.tenant_id = l.tenant_id and a.user_id = l.user_id and a.id = l.current_action_id
        where l.tenant_id = ${scope.tenantId} and l.user_id = ${scope.userId} and l.session_id = ${sessionId}
          and l.turn_id = ${turnId} and l.message_id is null and a.state = 'pending'
          and a.expires_at > ${now}::timestamptz and l.current_action_id = any(${sql.array(proposalIds, 'text')}) for update of l, a
      `);
        if (links.length !== proposalIds.length) {
          throw new ChatSessionStoreError('revision_conflict');
        }
        const messageId = generateStandardId();
        await connection.query(sql`
        insert into ai_chat_messages (id, tenant_id, user_id, session_id, turn_id, sequence, role, content)
        values (${messageId}, ${scope.tenantId}, ${scope.userId}, ${sessionId}, ${turnId}, ${session.next_sequence}, 'assistant', ${content})
      `);
        await connection.query(sql`
        update ai_chat_review_links set message_id = ${messageId} where ${where} and turn_id = ${turnId}
          and message_id is null and current_action_id = any(${sql.array(proposalIds, 'text')})
      `);
        await connection.query(sql`
        update ai_chat_sessions set stored_bytes = stored_bytes + ${Buffer.byteLength(content)}, message_count = message_count + 1,
          next_sequence = next_sequence + 1, transcript_revision = transcript_revision + 1, updated_at = now()
        where ${sessionWhere(scope, sessionId)}
      `);
      }
      await cancelTurnProposals(connection, scope, sessionId, turnId);
      await connection.query(sql`
      update ai_chat_turns set state = ${state}, error_code = ${errorCode}, updated_at = ${now}::timestamptz, completed_at = ${now}::timestamptz
      where ${where} and id = ${turnId}
    `);
      await connection.query(sql`
      update ai_chat_operations set kind = null, turn_id = null, lease_owner = null, lease_token = null,
        lease_expires_at = null, heartbeat_at = null, revision = revision + 1, updated_at = ${now}::timestamptz where ${where}
    `);
      const finished = await readTurn(connection, scope, sessionId, sql`t.id = ${turnId}`);
      if (!finished) {
        throw new ChatSessionStoreError('not_found');
      }
      return finished;
    });
  const check = async (
    scope: ChatScope,
    sessionId: string,
    turnId: string,
    leaseToken: string,
    heartbeat: boolean
  ) =>
    pool.transaction(async (connection) => {
      const session = await lockTurnSession(connection, scope, sessionId);
      const now = await serverTime(connection, options?.clock);
      await assertTurnLease(connection, scope, sessionId, turnId, leaseToken, now);
      if (session.archived) {
        throw new ChatSessionStoreError('session_archived');
      }
      if (heartbeat) {
        await connection.query(sql`
        update ai_chat_operations set heartbeat_at = ${now}::timestamptz,
          lease_expires_at = ${now}::timestamptz + ${chatLeaseExpiryMs} * interval '1 millisecond', updated_at = ${now}::timestamptz
        where ${turnWhere(scope, sessionId)}
      `);
      }
    });
  return {
    claim: async (scope, sessionId, value) => {
      const input = createTurnInputGuard.parse(value);
      const hash = hashTurnInput(input);
      return pool.transaction(async (connection): Promise<TurnClaim> => {
        try {
          await lockTurnSession(connection, scope, sessionId);
          const now = await serverTime(connection, options?.clock);
          const where = turnWhere(scope, sessionId);
          const existing = await findExistingTurn(connection, scope, sessionId, {
            requestId: input.requestId,
            hash,
            now,
          });
          if (existing) {
            return { kind: 'existing', turn: existing };
          }
          await reconcileOperation(connection, scope, sessionId, now);
          const session = await lockTurnSession(connection, scope, sessionId);
          if (session.archived) {
            throw new ChatSessionStoreError('session_archived');
          }
          if (session.transcript_revision !== input.expectedTranscriptRevision) {
            throw new ChatSessionStoreError('revision_conflict', session.transcript_revision);
          }
          const composer = await connection.one<{ revision: number; bytes: number }>(sql`
            select revision, octet_length(text) + coalesce((select sum(octet_length(a->>'name') + octet_length(a->>'text')) from jsonb_array_elements(attachments) a), 0)::integer as bytes
            from ai_chat_composers where ${where}
          `);
          const clearedBytes = composer.revision === input.composerRevision ? composer.bytes : 0;
          const content = serializeChatInput(input);
          const delta = Buffer.byteLength(content) + chatContentMaxBytes - clearedBytes;
          if (
            session.stored_bytes + delta > chatSessionMaxStoredBytes ||
            session.message_count + 2 > chatSessionMaxMessages
          ) {
            throw new ChatSessionStoreError('content_limit');
          }
          const turnId = generateStandardId();
          const leaseToken = randomUUID();
          await connection.query(sql`
            insert into ai_chat_turns (id, tenant_id, user_id, session_id, request_id, input_hash, lease_token, reserved_bytes, reserved_messages)
            values (${turnId}, ${scope.tenantId}, ${scope.userId}, ${sessionId}, ${input.requestId}, ${hash}, ${leaseToken}, ${chatContentMaxBytes}, 1)
          `);
          await connection.query(sql`
            insert into ai_chat_messages (id, tenant_id, user_id, session_id, turn_id, sequence, role, content)
            values (${generateStandardId()}, ${scope.tenantId}, ${scope.userId}, ${sessionId}, ${turnId}, ${session.next_sequence}, 'user', ${content})
          `);
          await connection.query(sql`
            update ai_chat_sessions set stored_bytes = stored_bytes + ${delta}, message_count = message_count + 2,
              next_sequence = next_sequence + 1, transcript_revision = transcript_revision + 1, updated_at = now() where ${sessionWhere(scope, sessionId)}
          `);
          await connection.query(sql`
            update ai_chat_composers set text = '', attachments = '[]'::jsonb, revision = revision + 1, updated_at = now()
            where ${where} and revision = ${input.composerRevision}
          `);
          await connection.query(sql`
            update ai_chat_operations set kind = 'generation', turn_id = ${turnId}, lease_token = ${leaseToken}, lease_owner = ${turnId},
              heartbeat_at = ${now}::timestamptz, lease_expires_at = ${now}::timestamptz + ${chatLeaseExpiryMs} * interval '1 millisecond',
              revision = revision + 1, updated_at = ${now}::timestamptz where ${where}
          `);
          const turn = await readTurn(connection, scope, sessionId, sql`t.id = ${turnId}`);
          if (!turn) {
            throw new ChatSessionStoreError('not_found');
          }
          return { kind: 'claimed', turn, leaseToken };
        } catch (error) {
          if (!(error instanceof ChatSessionStoreError)) {
            throw error;
          }
          return {
            kind: 'error',
            error: {
              error: error.code,
              ...(error.currentRevision === undefined
                ? {}
                : { currentRevision: error.currentRevision }),
            },
          };
        }
      });
    },
    heartbeat: async (scope, sessionId, turnId, leaseToken) =>
      check(scope, sessionId, turnId, leaseToken, true),
    assertOwned: async (scope, sessionId, turnId, leaseToken) =>
      check(scope, sessionId, turnId, leaseToken, false),
    complete: finish,
    fail: async (scope, sessionId, turnId, leaseToken, errorCode) =>
      finish(scope, sessionId, turnId, leaseToken, { errorCode }),
    get: async (scope, sessionId, requestId) =>
      pool.transaction(async (connection) => {
        try {
          await lockTurnSession(connection, scope, sessionId);
        } catch (error) {
          if (error instanceof ChatSessionStoreError && error.code === 'not_found') {
            return;
          }
          throw error;
        }
        const predicate =
          requestId === undefined
            ? sql`t.id = (select id from ai_chat_turns where ${turnWhere(scope, sessionId)} order by created_at desc, id desc limit 1)`
            : sql`t.request_id = ${requestId}`;
        const turn = await readTurn(connection, scope, sessionId, predicate);
        if (turn?.state !== 'running') {
          return turn;
        }
        await reconcileRetry(
          connection,
          scope,
          sessionId,
          await serverTime(connection, options?.clock)
        );
        return readTurn(connection, scope, sessionId, predicate);
      }),
  };
};

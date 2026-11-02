import { createHash } from 'node:crypto';

import {
  type ChatScope,
  type CreateTurnInput,
  chatContentMaxBytes,
  chatContentMaxCodeUnits,
  chatTurnGuard,
} from '@logto/schemas';
import { type DatabaseTransactionConnection, sql } from '@silverhand/slonik';
import { z } from 'zod/v3';

import { ChatSessionStoreError, reconcileOperation } from './ai-chat-session-operation.js';

export const hashTurnInput = (input: CreateTurnInput) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        input.expectedTranscriptRevision,
        input.composerRevision,
        input.text,
        input.attachments.map(({ id, name, text }) => [id, name, text]),
      ])
    )
    .digest('hex');

export const normalizeTurnResult = (
  result: { content: string; proposalIds: string[] } | { errorCode: string }
) => {
  if ('errorCode' in result) {
    return { state: 'failed', errorCode: result.errorCode, content: null, proposalIds: [] };
  }
  if (
    !result.content ||
    result.content.length > chatContentMaxCodeUnits ||
    Buffer.byteLength(result.content) > chatContentMaxBytes
  ) {
    return { state: 'failed', errorCode: 'content_limit', content: null, proposalIds: [] };
  }
  return {
    state: 'completed',
    errorCode: null,
    content: result.content,
    proposalIds: [...new Set(result.proposalIds)],
  };
};

export const reconcileRetry = async (
  connection: DatabaseTransactionConnection,
  scope: ChatScope,
  sessionId: string,
  now: string
) => {
  try {
    await reconcileOperation(connection, scope, sessionId, now);
  } catch (error) {
    if (!(error instanceof ChatSessionStoreError) || error.code !== 'session_busy') {
      throw error;
    }
  }
};

/** Session row is already locked. Hash comparison precedes every state-dependent retry. */
export const findExistingTurn = async (
  connection: DatabaseTransactionConnection,
  scope: ChatScope,
  sessionId: string,
  input: { requestId: string; hash: string; now: string }
) => {
  const existing = await readTurn(
    connection,
    scope,
    sessionId,
    sql`t.request_id = ${input.requestId}`
  );
  if (!existing) {
    return;
  }
  const hash = await connection.oneFirst<string>(
    sql`select input_hash from ai_chat_turns where ${turnWhere(scope, sessionId)} and id = ${existing.id}`
  );
  if (hash !== input.hash) {
    throw new ChatSessionStoreError('revision_conflict');
  }
  if (existing.state === 'running') {
    await reconcileRetry(connection, scope, sessionId, input.now);
  }
  return (await readTurn(connection, scope, sessionId, sql`t.id = ${existing.id}`)) ?? existing;
};

export const turnWhere = (scope: ChatScope, sessionId: string) =>
  sql`tenant_id = ${scope.tenantId} and user_id = ${scope.userId} and session_id = ${sessionId}`;
export const sessionWhere = (scope: ChatScope, sessionId: string) =>
  sql`tenant_id = ${scope.tenantId} and user_id = ${scope.userId} and id = ${sessionId}`;

export const lockTurnSession = async (
  connection: DatabaseTransactionConnection,
  scope: ChatScope,
  sessionId: string
) => {
  const row = await connection.maybeOne(sql`
    select archived_at is not null as archived, transcript_revision, next_sequence, stored_bytes, message_count
    from ai_chat_sessions where ${sessionWhere(scope, sessionId)} for update
  `);
  if (!row) {
    throw new ChatSessionStoreError('not_found');
  }
  return z
    .object({
      archived: z.boolean(),
      transcript_revision: z.number(),
      next_sequence: z.number(),
      stored_bytes: z.number(),
      message_count: z.number(),
    })
    .parse(row);
};

export const readTurn = async (
  connection: DatabaseTransactionConnection,
  scope: ChatScope,
  sessionId: string,
  predicate: ReturnType<typeof sql>
) => {
  const row = await connection.maybeOne(sql`
    select t.id, t.request_id as "requestId", t.state, t.error_code as "errorCode",
      to_char(t.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
      to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "updatedAt",
      to_char(t.completed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "completedAt",
      coalesce((select jsonb_agg(m.id order by m.sequence) from ai_chat_messages m
        where m.tenant_id = t.tenant_id and m.user_id = t.user_id and m.session_id = t.session_id and m.turn_id = t.id), '[]'::jsonb) as "messageIds"
    from ai_chat_turns t where ${turnWhere(scope, sessionId)} and ${predicate}
  `);
  return row ? chatTurnGuard.parse(row) : undefined;
};

export const serverTime = async (connection: DatabaseTransactionConnection, clock?: () => Date) =>
  clock
    ? clock().toISOString()
    : connection.oneFirst<string>(
        sql`select to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
      );

/** Caller holds the owned session row lock. Use within the SAME proposal insertion transaction. */
export const assertTurnLease = async (
  connection: DatabaseTransactionConnection,
  scope: ChatScope,
  sessionId: string,
  turnId: string,
  leaseToken: string,
  now: string
) => {
  const row = await connection.maybeOne(sql`
    select o.revision from ai_chat_operations o join ai_chat_turns t
      on t.tenant_id = o.tenant_id and t.user_id = o.user_id and t.session_id = o.session_id and t.id = o.turn_id
    where o.tenant_id = ${scope.tenantId} and o.user_id = ${scope.userId} and o.session_id = ${sessionId}
      and o.kind = 'generation' and o.turn_id = ${turnId} and o.lease_token = ${leaseToken}
      and t.lease_token = ${leaseToken} and t.state = 'running' and o.lease_expires_at > ${now}::timestamptz
  `);
  if (!row) {
    throw new ChatSessionStoreError('session_busy');
  }
};

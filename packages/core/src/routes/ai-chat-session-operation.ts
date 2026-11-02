import { type ChatScope, type ChatSessionErrorCode } from '@logto/schemas';
import { type DatabaseTransactionConnection, sql } from '@silverhand/slonik';
import { z } from 'zod/v3';

export class ChatSessionStoreError extends Error {
  constructor(
    public readonly code: ChatSessionErrorCode,
    public readonly currentRevision?: number
  ) {
    super(code);
    this.name = 'ChatSessionStoreError';
  }
}

/** Session row must be locked. Counters include committed content plus these reservations. */
export const releaseTurnReservation = async (
  connection: DatabaseTransactionConnection,
  scope: ChatScope,
  sessionId: string,
  turnId: string | undefined
) => {
  await connection.query(sql`
    update ai_chat_sessions s set stored_bytes = s.stored_bytes - t.reserved_bytes,
      message_count = s.message_count - t.reserved_messages
    from ai_chat_turns t where s.tenant_id = ${scope.tenantId} and s.user_id = ${scope.userId}
      and s.id = ${sessionId} and t.tenant_id = s.tenant_id and t.user_id = s.user_id
       and t.session_id = s.id and t.id = ${turnId ?? null}
  `);
  await connection.query(sql`
    update ai_chat_turns set reserved_bytes = 0, reserved_messages = 0
    where tenant_id = ${scope.tenantId} and user_id = ${scope.userId}
      and session_id = ${sessionId} and id = ${turnId ?? null}
  `);
};

/** Only unexposed proposals from this turn may be cancelled automatically. */
export const cancelTurnProposals = async (
  connection: DatabaseTransactionConnection,
  scope: ChatScope,
  sessionId: string,
  turnId: string | undefined
) => {
  await connection.query(sql`
    update ai_pending_actions a set state = 'cancelled', updated_at = now()
    where a.tenant_id = ${scope.tenantId} and a.user_id = ${scope.userId} and a.state = 'pending'
      and exists (select 1 from ai_chat_review_links l where l.tenant_id = a.tenant_id
        and l.user_id = a.user_id and l.session_id = ${sessionId} and l.turn_id = ${turnId ?? null}
        and l.message_id is null and (l.original_action_id = a.id or l.current_action_id = a.id))
  `);
};

/** Caller holds the session row, also the serialization point for operation claims. */
export const reconcileOperation = async (
  connection: DatabaseTransactionConnection,
  scope: ChatScope,
  id: string,
  now?: string
) => {
  const where = sql`tenant_id = ${scope.tenantId} and user_id = ${scope.userId} and session_id = ${id}`;
  // A confirmed external write may have succeeded even after its worker lease expired.
  // Never release that uncertainty or replay it; approval machinery must resolve it.
  const confirmed = await connection.maybeOne(sql`
    select a.id from ai_pending_actions a where a.tenant_id = ${scope.tenantId}
      and a.user_id = ${scope.userId} and a.state = 'confirmed' and exists (
        select 1 from ai_chat_review_links l where l.tenant_id = a.tenant_id
          and l.user_id = a.user_id and l.session_id = ${id}
          and (l.current_action_id = a.id or l.original_action_id = a.id)
      ) limit 1 for update
  `);
  const operation = z
    .object({ kind: z.string().nullable(), turn_id: z.string().nullable(), active: z.boolean() })
    .parse(
      await connection.one(sql`
    select kind, turn_id, lease_expires_at is null or lease_expires_at > coalesce(${now ?? null}::timestamptz, clock_timestamp()) as active
    from ai_chat_operations where ${where} for update
  `)
    );
  if (confirmed !== null || (operation.kind !== null && operation.active)) {
    throw new ChatSessionStoreError('session_busy');
  }
  if (operation.kind !== null) {
    await releaseTurnReservation(connection, scope, id, operation.turn_id ?? undefined);
    await cancelTurnProposals(connection, scope, id, operation.turn_id ?? undefined);
    await connection.query(sql`
      update ai_chat_turns set state = 'interrupted', error_code = 'lease_expired',
        updated_at = now(), completed_at = now()
      where tenant_id = ${scope.tenantId} and user_id = ${scope.userId}
        and session_id = ${id} and id = ${operation.turn_id} and state = 'running'
    `);
    await connection.query(sql`
      update ai_chat_operations set revision = revision + 1, kind = null, turn_id = null,
        lease_owner = null, lease_token = null, lease_expires_at = null, heartbeat_at = null,
        updated_at = now() where ${where}
    `);
  }
};

import { type ChatScope, chatLeaseHeartbeatMs } from '@logto/schemas';
import { type DatabasePool, type DatabaseTransactionConnection, sql } from '@silverhand/slonik';

import { ChatSessionStoreError } from './ai-chat-session-operation.js';
import { lockTurnSession, serverTime, turnWhere } from './ai-chat-session-turn-persistence.js';

type Lease = { scope: ChatScope; sessionId: string; token: string };

export const claimActionLease = async (
  connection: DatabaseTransactionConnection,
  lease: Lease,
  now: string
) => {
  await connection.query(sql`update ai_chat_operations set kind = 'approval', turn_id = null,
    revision = revision + 1, lease_owner = ${lease.token}, lease_token = ${lease.token},
    lease_expires_at = ${now}::timestamptz + interval '90 seconds', heartbeat_at = ${now}, updated_at = now()
    where ${turnWhere(lease.scope, lease.sessionId)}`);
};

export const releaseActionLease = async (
  connection: DatabaseTransactionConnection,
  lease: Lease
) => {
  await connection.query(sql`update ai_chat_operations set kind = null, turn_id = null,
    revision = revision + 1, lease_owner = null, lease_token = null, lease_expires_at = null,
    heartbeat_at = null, updated_at = now()
    where ${turnWhere(lease.scope, lease.sessionId)} and lease_token = ${lease.token}`);
};

/** No transaction spans external work. Confirmed actions continue blocking even after worker death. */
export const runWithActionLease = async <T>(
  pool: DatabasePool,
  lease: Lease,
  execute: (assertActive: () => Promise<void>) => Promise<T>
) => {
  const lost = new AbortController();
  const pending = new Set<Promise<void>>();
  const check = async (renew: boolean) =>
    pool.transaction(async (connection) => {
      await lockTurnSession(connection, lease.scope, lease.sessionId);
      const now = await serverTime(connection);
      const owned = await connection.maybeOne(sql`select session_id from ai_chat_operations
      where ${turnWhere(lease.scope, lease.sessionId)} and kind = 'approval'
        and lease_token = ${lease.token} and lease_expires_at > ${now}::timestamptz for update`);
      if (!owned) {
        throw new ChatSessionStoreError('session_busy');
      }
      if (renew) {
        await connection.query(sql`update ai_chat_operations set heartbeat_at = ${now},
        lease_expires_at = ${now}::timestamptz + interval '90 seconds'
        where ${turnWhere(lease.scope, lease.sessionId)} and lease_token = ${lease.token}`);
      }
    });
  const assertActive = async () => {
    if (lost.signal.aborted) {
      throw new ChatSessionStoreError('session_busy');
    }
    await check(false);
  };
  const heartbeat = setInterval(() => {
    const work = (async () => {
      try {
        await check(true);
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
  try {
    await assertActive();
    return await execute(assertActive);
  } finally {
    clearInterval(heartbeat);
    await Promise.all(pending);
  }
};

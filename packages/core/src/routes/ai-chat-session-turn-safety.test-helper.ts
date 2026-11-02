import { type ChatScope, type CreateTurnInput } from '@logto/schemas';
import { type DatabasePool, sql } from '@silverhand/slonik';

import { type ChatSessionStore } from './ai-chat-session-store.js';
import {
  createChatTurnStore,
  type ChatTurnStore,
  type TurnClaim,
} from './ai-chat-session-turn-store.js';

const { jest } = import.meta;

export const turnSafetyTests = (
  pool: () => DatabasePool,
  scope: ChatScope,
  fixture: {
    setup: () => Promise<{ turns: ChatTurnStore; sessions: ChatSessionStore; id: string }>;
    claimed: (turns: ChatTurnStore, id: string) => Promise<Extract<TurnClaim, { kind: 'claimed' }>>;
    proposal: (sessionId: string, turnId: string, messageId?: string) => Promise<string>;
    input: () => CreateTurnInput;
  }
) => {
  const { setup, claimed, proposal, input } = fixture;
  it('heartbeat_extends_past_original_expiry_and_wrong_token_cannot_extend', async () => {
    const { id } = await setup();
    const clock = jest.fn(() => new Date('2026-11-01T00:00:00Z'));
    const turns = createChatTurnStore(pool(), { clock });
    const first = await claimed(turns, id);
    clock.mockReturnValue(new Date('2026-11-01T00:01:00Z'));
    await turns.heartbeat(scope, id, first.turn.id, first.leaseToken);
    clock.mockReturnValue(new Date('2026-11-01T00:01:40Z'));
    await turns.assertOwned(scope, id, first.turn.id, first.leaseToken);
    await expect(turns.heartbeat(scope, id, first.turn.id, 'wrong')).rejects.toMatchObject({
      code: 'session_busy',
    });
    clock.mockReturnValue(new Date('2026-11-01T00:02:31Z'));
    await expect(
      turns.assertOwned(scope, id, first.turn.id, first.leaseToken)
    ).rejects.toMatchObject({ code: 'session_busy' });
  });
  it('get_reconciles_expired_turn_without_replay', async () => {
    const { turns, id } = await setup();
    const value = input();
    const first = await turns.claim(scope, id, value);
    expect(first.kind).toBe('claimed');
    await pool().query(
      sql`update ai_chat_operations set lease_expires_at = now() - interval '1 second' where session_id = ${id}`
    );
    const interrupted = await turns.get(scope, id, value.requestId);
    expect(interrupted).toMatchObject({ state: 'interrupted', errorCode: 'lease_expired' });
    expect(await turns.claim(scope, id, value)).toEqual({ kind: 'existing', turn: interrupted });
    expect(
      await pool().one(
        sql`select stored_bytes, message_count from ai_chat_sessions where id = ${id}`
      )
    ).toEqual({ storedBytes: 5, messageCount: 1 });
  });
  it('completion_attaches_only_owned_unexposed_turn_proposals', async () => {
    const { turns, sessions, id } = await setup();
    const first = await claimed(turns, id);
    const actionId = await proposal(id, first.turn.id);
    const foreign = await setup();
    const foreignTurn = await claimed(foreign.turns, foreign.id);
    const foreignAction = await proposal(foreign.id, foreignTurn.turn.id);
    await expect(
      turns.complete(scope, id, first.turn.id, first.leaseToken, {
        content: 'answer',
        proposalIds: [foreignAction],
      })
    ).rejects.toMatchObject({ code: 'revision_conflict' });
    expect(
      await pool().oneFirst(sql`select message_count from ai_chat_sessions where id = ${id}`)
    ).toBe(2);
    await turns.complete(scope, id, first.turn.id, first.leaseToken, {
      content: 'answer',
      proposalIds: [actionId],
    });
    const messages = await sessions.messages(scope, id);
    expect(messages.items[1]?.reviews).toMatchObject([
      { currentActionId: actionId, state: 'pending' },
    ]);
    expect(
      await pool().oneFirst(
        sql`select message_id from ai_chat_review_links where current_action_id = ${foreignAction}`
      )
    ).toBeNull();
  });
  it('stale_reconciliation_cancels_only_unexposed_pending_proposals', async () => {
    const { turns, sessions, id } = await setup();
    const first = await claimed(turns, id);
    const hidden = await proposal(id, first.turn.id);
    const exposed = await proposal(id, first.turn.id, first.turn.messageIds[0]);
    await pool().query(
      sql`update ai_chat_operations set lease_expires_at = now() - interval '1 second' where session_id = ${id}`
    );
    await sessions.update(scope, id, { expectedRevision: 0, archived: true });
    expect(
      await pool().oneFirst(sql`select state from ai_pending_actions where id = ${hidden}`)
    ).toBe('cancelled');
    expect(
      await pool().oneFirst(sql`select state from ai_pending_actions where id = ${exposed}`)
    ).toBe('pending');
    await expect(
      turns.complete(scope, id, first.turn.id, first.leaseToken, {
        content: 'late',
        proposalIds: [hidden],
      })
    ).rejects.toMatchObject({ code: 'session_busy' });
    expect(
      await pool().oneFirst(
        sql`select message_id from ai_chat_review_links where current_action_id = ${hidden}`
      )
    ).toBeNull();
  });
  it('claim_waits_for_the_same_session_lock_used_by_archive', async () => {
    const { turns, id } = await setup();
    const independent = await setup();
    // Promise.withResolvers is not supported by the lint environment's native inventory.
    const locked = deferred();
    const release = deferred();
    const archiving = pool().transaction(async (connection) => {
      await connection.query(sql`select id from ai_chat_sessions where id = ${id} for update`);
      locked.resolve();
      await release.promise;
      await connection.query(sql`update ai_chat_sessions set archived_at = now() where id = ${id}`);
    });
    await locked.promise;
    const waiting = turns.claim(scope, id, input());
    try {
      await claimed(independent.turns, independent.id);
    } finally {
      release.resolve();
    }
    await archiving;
    expect(await waiting).toMatchObject({ kind: 'error', error: { error: 'session_archived' } });
    expect(await pool().any(sql`select id from ai_chat_turns where session_id = ${id}`)).toEqual(
      []
    );
  });
};

export const deferred = () => {
  // eslint-disable-next-line @silverhand/fp/no-let -- Explicit transaction barriers, not timing sleeps.
  let finish: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    // eslint-disable-next-line @silverhand/fp/no-mutation -- Capture the barrier resolver.
    finish = resolve;
  });
  return { promise, resolve: () => finish?.() };
};

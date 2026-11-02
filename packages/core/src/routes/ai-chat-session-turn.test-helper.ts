import { randomUUID } from 'node:crypto';

import {
  type ChatScope,
  type CreateTurnInput,
  chatContentMaxBytes,
  chatSessionMaxStoredBytes,
} from '@logto/schemas';
import { type DatabasePool, sql } from '@silverhand/slonik';

import { sessionActionTests } from './ai-chat-session-actions.test-helper.js';
import { reconnectTests } from './ai-chat-session-reconnect.test-helper.js';
import { sessionRunTests } from './ai-chat-session-run.test-helper.js';
import { createChatSessionStore } from './ai-chat-session-store.js';
import { turnSafetyTests } from './ai-chat-session-turn-safety.test-helper.js';
import {
  createChatTurnStore,
  type ChatTurnStore,
  type TurnClaim,
} from './ai-chat-session-turn-store.js';

const { jest } = import.meta;

const input = (): CreateTurnInput => ({
  requestId: randomUUID(),
  expectedTranscriptRevision: 0,
  composerRevision: 0,
  text: 'hello',
  attachments: [],
});

export const turnTests = (pool: () => DatabasePool, scope: ChatScope) => {
  reconnectTests(pool, scope);
  const setup = async () => {
    const sessions = createChatSessionStore(pool());
    const session = await sessions.create(scope, randomUUID());
    return { sessions, id: session.id, turns: createChatTurnStore(pool()) };
  };
  const claimed = async (turns: ChatTurnStore, id: string, value = input()) => {
    const result = await turns.claim(scope, id, value);
    if (result.kind !== 'claimed') {
      throw new Error(`Expected claim: ${JSON.stringify(result)}`);
    }
    return result;
  };
  const proposal = async (sessionId: string, turnId: string, messageId?: string) => {
    const id = randomUUID().slice(0, 21);
    await pool().query(sql`
      insert into ai_pending_actions (id, tenant_id, user_id, tool, arguments, arguments_hash, expires_at)
      values (${id}, ${scope.tenantId}, ${scope.userId}, 'test', '{}', 'hash', now() + interval '1 day')
    `);
    await pool().query(sql`
      insert into ai_chat_review_links (id, tenant_id, user_id, session_id, turn_id, message_id, original_action_id, current_action_id)
      values (${id}, ${scope.tenantId}, ${scope.userId}, ${sessionId}, ${turnId}, ${messageId ?? null}, ${id}, ${id})
    `);
    return id;
  };
  turnSafetyTests(pool, scope, { setup, claimed, proposal, input });
  sessionRunTests(pool, scope);
  sessionActionTests(pool, scope);
  it('same_request_never_reexecutes', async () => {
    const { turns, id, sessions } = await setup();
    const value = input();
    const results: TurnClaim[] = await Promise.all([
      turns.claim(scope, id, value),
      turns.claim(scope, id, value),
    ]);
    expect(results.map(({ kind }) => kind).toSorted()).toEqual(['claimed', 'existing']);
    const first = results.find((result) => result.kind === 'claimed');
    if (first?.kind !== 'claimed') {
      throw new Error('Missing winner');
    }
    expect(JSON.stringify(first.turn)).not.toContain(first.leaseToken);
    const completed = await turns.complete(scope, id, first.turn.id, first.leaseToken, {
      content: 'answer',
      proposalIds: [],
    });
    expect(
      await turns.complete(scope, id, first.turn.id, first.leaseToken, {
        content: 'answer',
        proposalIds: [],
      })
    ).toEqual(completed);
    expect(await turns.claim(scope, id, value)).toEqual({ kind: 'existing', turn: completed });
    expect(await turns.get(scope, id, value.requestId)).toEqual(completed);
    const history = await sessions.messages(scope, id);
    expect(history.items.map(({ sequence }) => sequence)).toEqual([1, 2]);
    expect(await turns.claim(scope, id, { ...value, text: 'substitution' })).toMatchObject({
      kind: 'error',
      error: { error: 'revision_conflict' },
    });
  });
  it('different_request_while_busy_conflicts', async () => {
    const { turns, id, sessions } = await setup();
    await claimed(turns, id);
    expect(await turns.claim(scope, id, input())).toMatchObject({
      kind: 'error',
      error: { error: 'session_busy' },
    });
    await expect(sessions.remove(scope, id, 0)).rejects.toMatchObject({ code: 'session_busy' });
    await expect(
      sessions.update(scope, id, { expectedRevision: 0, archived: true })
    ).rejects.toMatchObject({ code: 'session_busy' });
  });
  it('expired_worker_cannot_complete_or_attach_proposals', async () => {
    const { id, sessions } = await setup();
    const clock = jest.fn(() => new Date('2026-11-01T00:00:00Z'));
    const turns = createChatTurnStore(pool(), { clock });
    const first = await claimed(turns, id);
    clock.mockReturnValue(new Date('2026-11-01T00:01:29Z'));
    await turns.heartbeat(scope, id, first.turn.id, first.leaseToken);
    clock.mockReturnValue(new Date('2026-11-01T00:03:00Z'));
    await expect(
      turns.assertOwned(scope, id, first.turn.id, first.leaseToken)
    ).rejects.toMatchObject({ code: 'session_busy' });
    await expect(
      turns.complete(scope, id, first.turn.id, first.leaseToken, {
        content: 'late',
        proposalIds: ['foreign'],
      })
    ).rejects.toMatchObject({ code: 'session_busy' });
    await expect(turns.heartbeat(scope, id, first.turn.id, first.leaseToken)).rejects.toMatchObject(
      { code: 'session_busy' }
    );
    const retry = await turns.claim(scope, id, { ...input(), expectedTranscriptRevision: 1 });
    expect(retry.kind).toBe('claimed');
    expect(await turns.get(scope, id, first.turn.requestId)).toMatchObject({
      state: 'interrupted',
      errorCode: 'lease_expired',
    });
    const history = await sessions.messages(scope, id);
    expect(history.items).toHaveLength(2);
  });
  it('two_sessions_can_run_independently', async () => {
    const first = await setup();
    const second = await setup();
    const results = await Promise.all([
      first.turns.claim(scope, first.id, input()),
      second.turns.claim(scope, second.id, input()),
    ]);
    expect(results.map(({ kind }) => kind)).toEqual(['claimed', 'claimed']);
  });
  it('failed_turn_keeps_user_message', async () => {
    const { turns, id, sessions } = await setup();
    const first = await claimed(turns, id);
    await expect(
      turns.fail(scope, id, first.turn.id, 'wrong', 'unavailable')
    ).rejects.toMatchObject({ code: 'session_busy' });
    const failed = await turns.fail(scope, id, first.turn.id, first.leaseToken, 'unavailable');
    expect(await turns.fail(scope, id, first.turn.id, first.leaseToken, 'unavailable')).toEqual(
      failed
    );
    expect(failed).toMatchObject({ state: 'failed', errorCode: 'unavailable' });
    const history = await sessions.messages(scope, id);
    expect(history.items.map(({ content }) => content)).toEqual(['hello']);
    expect(
      await pool().one(
        sql`select stored_bytes, message_count from ai_chat_sessions where id = ${id}`
      )
    ).toEqual({ storedBytes: 5, messageCount: 1 });
  });
  it('clearing_sent_composer_does_not_clear_newer_revision', async () => {
    const { turns, id, sessions } = await setup();
    await sessions.saveComposer(scope, id, { expectedRevision: 0, text: 'newer', attachments: [] });
    const first = await claimed(turns, id);
    expect(await sessions.getComposer(scope, id)).toMatchObject({ text: 'newer', revision: 1 });
    await sessions.saveComposer(scope, id, {
      expectedRevision: 1,
      text: 'newest',
      attachments: [],
    });
    await turns.complete(scope, id, first.turn.id, first.leaseToken, {
      content: 'yes',
      proposalIds: [],
    });
    expect(await sessions.getComposer(scope, id)).toMatchObject({ text: 'newest', revision: 2 });
    expect(
      await pool().oneFirst(sql`select stored_bytes from ai_chat_sessions where id = ${id}`)
    ).toBe(14);
    const next = await claimed(turns, id, {
      ...input(),
      expectedTranscriptRevision: 2,
      composerRevision: 2,
    });
    expect(await sessions.getComposer(scope, id)).toMatchObject({ text: '', revision: 3 });
    await turns.fail(scope, id, next.turn.id, next.leaseToken, 'failed');
  });
  it('quota_claims_are_atomic', async () => {
    const { turns, id, sessions } = await setup();
    await pool().query(
      sql`update ai_chat_sessions set stored_bytes = ${chatSessionMaxStoredBytes - chatContentMaxBytes - 5}, message_count = 1998 where id = ${id}`
    );
    const results = await Promise.all([
      turns.claim(scope, id, input()),
      turns.claim(scope, id, input()),
    ]);
    expect(results.filter(({ kind }) => kind === 'claimed')).toHaveLength(1);
    expect(
      await pool().one(
        sql`select stored_bytes, message_count from ai_chat_sessions where id = ${id}`
      )
    ).toEqual({ storedBytes: chatSessionMaxStoredBytes, messageCount: 2000 });
    await expect(
      sessions.saveComposer(scope, id, { expectedRevision: 1, text: 'x', attachments: [] })
    ).rejects.toMatchObject({ code: 'content_limit' });
    const winner = results.find((result) => result.kind === 'claimed');
    if (winner?.kind !== 'claimed') {
      throw new Error('Missing winner');
    }
    await turns.fail(scope, id, winner.turn.id, winner.leaseToken, 'failed');
    expect(
      await turns.claim(scope, id, {
        ...input(),
        expectedTranscriptRevision: 1,
        composerRevision: 1,
      })
    ).toMatchObject({ kind: 'error', error: { error: 'content_limit' } });
  });
  it('stale_reconciliation_commits_even_when_new_request_revision_conflicts', async () => {
    const { turns, id } = await setup();
    const first = await claimed(turns, id);
    await pool().query(
      sql`update ai_chat_operations set lease_expires_at = now() - interval '1 second' where session_id = ${id}`
    );
    expect(await turns.claim(scope, id, input())).toMatchObject({
      kind: 'error',
      error: { error: 'revision_conflict', currentRevision: 1 },
    });
    expect(await turns.get(scope, id, first.turn.requestId)).toMatchObject({
      state: 'interrupted',
    });
    expect(
      await pool().one(
        sql`select stored_bytes, message_count from ai_chat_sessions where id = ${id}`
      )
    ).toEqual({ storedBytes: 5, messageCount: 1 });
  });
  it('lifecycle_reconciliation_releases_once_and_preserves_composer_deltas', async () => {
    const { turns, sessions, id } = await setup();
    const first = await claimed(turns, id);
    await sessions.saveComposer(scope, id, {
      expectedRevision: 1,
      text: '🌍draft',
      attachments: [],
    });
    await pool().query(
      sql`update ai_chat_operations set lease_expires_at = now() - interval '1 second' where session_id = ${id}`
    );
    await sessions.update(scope, id, { expectedRevision: 0, archived: true });
    expect(await turns.get(scope, id, first.turn.requestId)).toMatchObject({
      state: 'interrupted',
    });
    expect(
      await pool().one(
        sql`select stored_bytes, message_count from ai_chat_sessions where id = ${id}`
      )
    ).toEqual({ storedBytes: 14, messageCount: 1 });
    await sessions.update(scope, id, { expectedRevision: 1, archived: false });
    await sessions.update(scope, id, { expectedRevision: 2, archived: true });
    expect(
      await pool().oneFirst(sql`select stored_bytes from ai_chat_sessions where id = ${id}`)
    ).toBe(14);
  });
  it('oversized_completion_releases_reservation_and_keeps_only_user_message', async () => {
    const { turns, sessions, id } = await setup();
    const first = await claimed(turns, id);
    const result = { content: 'x'.repeat(8001), proposalIds: [] };
    const failed = await turns.complete(scope, id, first.turn.id, first.leaseToken, result);
    expect(failed).toMatchObject({ state: 'failed', errorCode: 'content_limit' });
    expect(await turns.complete(scope, id, first.turn.id, first.leaseToken, result)).toEqual(
      failed
    );
    const history = await sessions.messages(scope, id);
    expect(history.items).toHaveLength(1);
    expect(
      await pool().one(
        sql`select stored_bytes, message_count from ai_chat_sessions where id = ${id}`
      )
    ).toEqual({ storedBytes: 5, messageCount: 1 });
  });
  it('foreign_and_archived_sessions_cannot_claim_or_mutate_turns', async () => {
    const { turns, sessions, id } = await setup();
    const stranger = { ...scope, userId: 'other-user' };
    expect(await turns.claim(stranger, id, input())).toMatchObject({
      kind: 'error',
      error: { error: 'not_found' },
    });
    const first = await claimed(turns, id);
    expect(await turns.get(stranger, id, first.turn.requestId)).toBeUndefined();
    await expect(
      turns.heartbeat(stranger, id, first.turn.id, first.leaseToken)
    ).rejects.toMatchObject({ code: 'not_found' });
    await turns.fail(scope, id, first.turn.id, first.leaseToken, 'failed');
    await sessions.update(scope, id, { expectedRevision: 0, archived: true });
    expect(await turns.claim(scope, id, input())).toMatchObject({
      kind: 'error',
      error: { error: 'session_archived' },
    });
  });
};

import { randomUUID } from 'node:crypto';

import { type ChatScope, chatSessionMaxStoredBytes } from '@logto/schemas';
import { type DatabasePool, sql } from '@silverhand/slonik';

import { proposePendingAction } from './ai-chat-actions.js';
import { createTurnProposalStore } from './ai-chat-session-proposals.js';
import { createChatSessionStore } from './ai-chat-session-store.js';
import { deferred } from './ai-chat-session-turn-safety.test-helper.js';
import { createChatTurnStore } from './ai-chat-session-turn-store.js';

export const proposalTests = (pool: () => DatabasePool, scope: ChatScope) => {
  const setup = async () => {
    const sessions = createChatSessionStore(pool());
    const { id } = await sessions.create(scope, randomUUID());
    const turns = createChatTurnStore(pool());
    const claim = await turns.claim(scope, id, {
      requestId: randomUUID(),
      expectedTranscriptRevision: 0,
      composerRevision: 0,
      text: 'hello',
      attachments: [],
    });
    if (claim.kind !== 'claimed') {
      throw new Error('Missing claim');
    }
    const store = createTurnProposalStore(pool(), scope, id, claim.turn.id, claim.leaseToken);
    const propose = async (target = store) =>
      proposePendingAction({
        store: target,
        tool: 'create_organization',
        args: { name: 'é' },
        ...scope,
        now: new Date(),
      });
    return { id, sessions, turns, claim, store, propose };
  };
  it('proposal_insert_and_run_ownership_are_atomic_and_actual_bytes_are_separate', async () => {
    const { id, sessions, turns, claim, propose } = await setup();
    const proposal = await propose();
    if (!proposal.ok) {
      throw new Error('Missing proposal');
    }
    const before = await sessions.messages(scope, id);
    expect(before.items[0]?.reviews).toEqual([]);
    expect(
      await pool().one(
        sql`select stored_bytes, message_count from ai_chat_sessions where id = ${id}`
      )
    ).toEqual({ storedBytes: 5 + 32_768 + 13, messageCount: 2 });
    expect(
      await pool().oneFirst(
        sql`select reserved_bytes from ai_chat_turns where id = ${claim.turn.id}`
      )
    ).toBe(32_768);
    await turns.complete(scope, id, claim.turn.id, claim.leaseToken, {
      content: 'answer',
      proposalIds: [proposal.action.id],
    });
    const after = await sessions.messages(scope, id);
    expect(after.items.at(-1)?.reviews).toMatchObject([{ body: { name: 'é' } }]);
    await expect(propose()).rejects.toMatchObject({ code: 'session_busy' });
    expect(
      await pool().oneFirst(
        sql`select count(*)::integer from ai_chat_review_links where session_id = ${id}`
      )
    ).toBe(1);
  });
  it('proposal_quota_failure_rolls_back_action_and_hidden_link', async () => {
    const { id, propose } = await setup();
    await pool().query(
      sql`update ai_chat_sessions set stored_bytes = ${chatSessionMaxStoredBytes - 1} where id = ${id}`
    );
    await expect(propose()).rejects.toMatchObject({ code: 'content_limit' });
    expect(
      await pool().oneFirst(
        sql`select count(*)::integer from ai_chat_review_links where session_id = ${id}`
      )
    ).toBe(0);
  });
  it('lost_token_and_deleted_session_cannot_insert_or_expose_proposals', async () => {
    const { id, claim, propose, turns, sessions } = await setup();
    await expect(
      propose(createTurnProposalStore(pool(), scope, id, claim.turn.id, 'wrong'))
    ).rejects.toMatchObject({ code: 'session_busy' });
    await turns.fail(scope, id, claim.turn.id, claim.leaseToken, 'unavailable');
    await sessions.remove(scope, id, 0);
    await expect(propose()).rejects.toMatchObject({ code: 'not_found' });
  });
  it.each(['archive', 'delete', 'lease'] as const)(
    'proposal waits for session lock before %s fence check',
    async (change) => {
      const { id, propose } = await setup();
      const locked = deferred();
      const release = deferred();
      const mutation = pool().transaction(async (connection) => {
        await connection.query(sql`select id from ai_chat_sessions where id = ${id} for update`);
        locked.resolve();
        await release.promise;
        if (change === 'delete') {
          await connection.query(sql`delete from ai_chat_sessions where id = ${id}`);
        } else if (change === 'archive') {
          await connection.query(
            sql`update ai_chat_sessions set archived_at = now() where id = ${id}`
          );
        } else {
          await connection.query(
            sql`update ai_chat_operations set lease_token = 'replacement' where session_id = ${id}`
          );
        }
      });
      await locked.promise;
      const waiting = propose();
      // Another session can still be created while this row is held on a separate connection.
      try {
        await createChatSessionStore(pool()).create(scope, randomUUID());
      } finally {
        release.resolve();
      }
      await mutation;
      await expect(waiting).rejects.toMatchObject({
        code:
          change === 'delete'
            ? 'not_found'
            : change === 'archive'
              ? 'session_archived'
              : 'session_busy',
      });
      expect(
        await pool().oneFirst(
          sql`select count(*)::integer from ai_chat_review_links where session_id = ${id}`
        )
      ).toBe(0);
    }
  );
  it('authoritative_registry_rejects_invalid_types_unknown_tools_and_exact_body_substitution', async () => {
    const { store } = await setup();
    await expect(
      proposePendingAction({
        store,
        tool: 'create_organization',
        args: { name: 42 },
        ...scope,
        now: new Date(),
      })
    ).rejects.toMatchObject({ code: 'revision_conflict' });
    const captured = new Set<Parameters<typeof store.insert>[0]>();
    await proposePendingAction({
      store: {
        insert: async (action) => {
          captured.add(action);
        },
      },
      tool: 'create_organization',
      args: { name: 'valid' },
      ...scope,
      now: new Date(),
    });
    const [action] = captured;
    if (!action) {
      throw new Error('Missing action');
    }
    await expect(
      store.insert({ ...action, body: { name: 'substituted' } }, { name: 'valid' })
    ).rejects.toMatchObject({ code: 'revision_conflict' });
    await expect(
      store.insert({ ...action, tool: 'not_a_tool' }, { name: 'valid' })
    ).rejects.toMatchObject({ code: 'revision_conflict' });
  });
};

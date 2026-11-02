import { randomUUID } from 'node:crypto';

import { type ChatScope, defaultLandingPageContent } from '@logto/schemas';
import { type DatabasePool, sql } from '@silverhand/slonik';

import {
  confirmPendingAction,
  proposePendingAction,
  hashBody,
  createPendingActionStore,
} from './ai-chat-actions.js';
import { createSessionActionStore } from './ai-chat-session-actions.js';
import { createTurnProposalStore } from './ai-chat-session-proposals.js';
import { createChatSessionStore } from './ai-chat-session-store.js';
import { deferred } from './ai-chat-session-turn-safety.test-helper.js';
import { createChatTurnStore } from './ai-chat-session-turn-store.js';

const { jest } = import.meta;

export const sessionActionTests = (pool: () => DatabasePool, scope: ChatScope) => {
  const actions = () => createSessionActionStore(pool());
  const setup = async (exposed = true, landing = false) => {
    const sessions = createChatSessionStore(pool());
    const session = await sessions.create(scope, randomUUID());
    const turns = createChatTurnStore(pool());
    const claim = await turns.claim(scope, session.id, {
      requestId: randomUUID(),
      expectedTranscriptRevision: 0,
      composerRevision: 0,
      text: 'create organization',
      attachments: [],
    });
    if (claim.kind !== 'claimed') {
      throw new Error('Missing claim');
    }
    const result = await proposePendingAction({
      store: createTurnProposalStore(pool(), scope, session.id, claim.turn.id, claim.leaseToken),
      tool: landing ? 'save_landing_page_draft' : 'create_organization',
      args: landing ? { draft: defaultLandingPageContent } : { name: 'Reviewed exact name' },
      ...scope,
      now: new Date(),
    });
    if (!result.ok) {
      throw new Error('Missing proposal');
    }
    if (exposed) {
      await turns.complete(scope, session.id, claim.turn.id, claim.leaseToken, {
        content: 'Review before saving',
        proposalIds: [result.action.id],
      });
    }
    return { id: session.id, action: result.action, sessions };
  };
  const confirm = async (id: string, sessionId?: string) =>
    actions().withSessionActionOperation(scope, id, { kind: 'confirm', sessionId }, async (store) =>
      confirmPendingAction({
        store,
        id,
        ...scope,
        now: new Date(),
        execute: async () => ({ content: [] }),
      })
    );

  it.each(['executed', 'confirmed', 'cancelled'] as const)(
    'executed_expired_and_confirmed_reviews_are_not_pending: %s',
    async (state) => {
      const { id, action } = await setup();
      await pool().query(
        sql`update ai_pending_actions set state = ${state} where id = ${action.id}`
      );
      expect(await actions().getSessionReviews(scope, id)).toMatchObject([
        { state, isError: null },
      ]);
      await pool().query(
        sql`update ai_pending_actions set state = 'pending', expires_at = now() - interval '1 second' where id = ${action.id}`
      );
      expect(await actions().getSessionReviews(scope, id)).toMatchObject([{ state: 'expired' }]);
    }
  );
  it('latest_id_restores_after_two_refreshes', async () => {
    const { id, action, sessions } = await setup();
    const first = await actions().refreshSessionReview(scope, id, action.id, action.id);
    const second = await actions().refreshSessionReview(
      scope,
      id,
      action.id,
      first.currentActionId
    );
    expect(second.currentActionId).not.toBe(first.currentActionId);
    expect(await actions().getSessionReviews(scope, id)).toEqual([second]);
    expect(second.body).toEqual(action.body);
    await expect(confirm(first.currentActionId)).rejects.toMatchObject({ code: 'review_replaced' });
    await sessions.remove(scope, id, 0);
    await pool().query(
      sql`update ai_pending_actions set state = 'pending' where id = ${first.currentActionId}`
    );
    await expect(confirm(first.currentActionId)).rejects.toMatchObject({ code: 'not_found' });
  });
  it('cross_session_action_injection_is_404', async () => {
    const first = await setup();
    const second = await setup();
    await expect(confirm(first.action.id, second.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      actions().refreshSessionReview(scope, second.id, first.action.id, first.action.id)
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      actions().getSessionReviews({ ...scope, userId: 'other' }, first.id)
    ).rejects.toMatchObject({ code: 'not_found' });
  });
  it('legacy_endpoint_cannot_confirm_archived_or_deleted_link', async () => {
    const { id, action, sessions } = await setup();
    await sessions.update(scope, id, { expectedRevision: 0, archived: true });
    await expect(confirm(action.id)).rejects.toMatchObject({ code: 'session_archived' });
    await sessions.remove(scope, id, 1);
    await pool().query(
      sql`update ai_pending_actions set state = 'pending' where id = ${action.id}`
    );
    await expect(confirm(action.id)).rejects.toMatchObject({ code: 'not_found' });
    const hidden = await setup(false);
    await expect(confirm(hidden.action.id)).rejects.toMatchObject({ code: 'not_found' });
  });
  it('delete_racing_confirmation_has_single_winner', async () => {
    const { id, action, sessions } = await setup();
    const started = deferred();
    const release = deferred();
    const winning = actions().withSessionActionOperation(
      scope,
      action.id,
      { kind: 'confirm' },
      async (store) =>
        confirmPendingAction({
          store,
          id: action.id,
          ...scope,
          now: new Date(),
          execute: async () => {
            started.resolve();
            await release.promise;
            return { content: [] };
          },
        })
    );
    await started.promise;
    try {
      await expect(sessions.remove(scope, id, 0)).rejects.toMatchObject({ code: 'session_busy' });
      await expect(confirm(action.id)).rejects.toMatchObject({ code: 'session_busy' });
      await expect(
        actions().refreshSessionReview(scope, id, action.id, action.id)
      ).rejects.toMatchObject({ code: 'session_busy' });
    } finally {
      release.resolve();
    }
    expect(await winning).toMatchObject({ ok: true });
    const deleted = await setup();
    await deleted.sessions.remove(scope, deleted.id, 0);
    await expect(confirm(deleted.action.id)).rejects.toMatchObject({ code: 'not_found' });
  });
  it('two_device_refreshes_have_one_replacement', async () => {
    const { id, action } = await setup();
    const result = await Promise.allSettled([
      actions().refreshSessionReview(scope, id, action.id, action.id),
      actions().refreshSessionReview(scope, id, action.id, action.id),
    ]);
    expect(result.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(result.find((item) => item.status === 'rejected')).toMatchObject({
      status: 'rejected',
      reason: { code: 'review_replaced' },
    });
  });
  it.each(['confirm', 'cancel'] as const)(
    'refresh_racing_%s_cannot_execute_a_stale_review',
    async (kind) => {
      const { id, action } = await setup();
      const mutation = async () =>
        kind === 'confirm'
          ? confirm(action.id)
          : actions().withSessionActionOperation(scope, action.id, { kind }, async (store) =>
              store.cancel(action.id, scope.tenantId, scope.userId)
            );
      const outcomes = await Promise.allSettled([
        actions().refreshSessionReview(scope, id, action.id, action.id),
        mutation(),
      ]);
      const reviews = await actions().getSessionReviews(scope, id);
      const latest = reviews[0];
      expect(latest).toBeDefined();
      if (latest?.currentActionId === action.id) {
        expect(outcomes[0].status).toBe('rejected');
        expect(outcomes[1].status).toBe('fulfilled');
        expect(latest.state).toBe(kind === 'confirm' ? 'executed' : 'cancelled');
      } else {
        expect(outcomes[0].status).toBe('fulfilled');
        expect(outcomes[1].status).toBe('rejected');
        await expect(confirm(action.id)).rejects.toMatchObject({ code: 'review_replaced' });
      }
    }
  );
  it('truly_unlinked_legacy_actions_keep_their_existing_behavior', async () => {
    const proposal = await proposePendingAction({
      store: createPendingActionStore(pool()),
      tool: 'create_organization',
      args: { name: 'Legacy' },
      ...scope,
      now: new Date(),
    });
    if (!proposal.ok) {
      throw new Error('Missing proposal');
    }
    expect(await confirm(proposal.action.id)).toMatchObject({ ok: true });
  });
  it('expired_linked_confirmation_never_executes_and_refresh_keeps_five_minute_ttl', async () => {
    const { id, action, sessions } = await setup();
    await pool().query(
      sql`update ai_pending_actions set expires_at = now() - interval '1 second' where id = ${action.id}`
    );
    expect(await confirm(action.id)).toEqual({ ok: false, code: 'expired' });
    const messages = await sessions.messages(scope, id);
    expect(messages.items.at(-1)?.reviews[0]?.state).toBe('expired');
    const replacement = await actions().refreshSessionReview(scope, id, action.id, action.id);
    const remaining = Number(
      await pool().oneFirst(
        sql`select extract(epoch from (${replacement.expiresAt}::timestamptz - clock_timestamp())) * 1000`
      )
    );
    expect(remaining).toBeGreaterThan(4 * 60 * 1000);
    expect(remaining).toBeLessThanOrEqual(5 * 60 * 1000);
  });
  it('refresh_never_executes_save', async () => {
    const { id, action } = await setup(true, true);
    const execute = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('No real requests'));
    const replacement = await actions().refreshSessionReview(scope, id, action.id, action.id);
    expect(replacement.body).toEqual(action.body);
    const remaining = Number(
      await pool().oneFirst(
        sql`select extract(epoch from (${replacement.expiresAt}::timestamptz - clock_timestamp())) * 1000`
      )
    );
    expect(remaining).toBeGreaterThan(29 * 60 * 1000);
    expect(remaining).toBeLessThanOrEqual(30 * 60 * 1000);
    expect(execute).not.toHaveBeenCalled();
    execute.mockRestore();
    expect(await actions().getSessionReviews(scope, id)).toMatchObject([{ state: 'pending' }]);
  });
  it('confirmed_unknown_outcome_blocks_after_lease_expiry_without_replay', async () => {
    const { id, action, sessions } = await setup();
    await expect(
      actions().withSessionActionOperation(scope, action.id, { kind: 'confirm' }, async (store) =>
        confirmPendingAction({
          store,
          id: action.id,
          ...scope,
          now: new Date(),
          execute: async () => {
            throw new Error('Unknown transport outcome');
          },
        })
      )
    ).rejects.toThrow('Unknown transport outcome');
    await pool().query(
      sql`update ai_chat_operations set lease_expires_at = now() - interval '1 day' where session_id = ${id}`
    );
    await expect(confirm(action.id)).rejects.toMatchObject({ code: 'session_busy' });
    await expect(sessions.remove(scope, id, 0)).rejects.toMatchObject({ code: 'session_busy' });
    await expect(
      actions().refreshSessionReview(scope, id, action.id, action.id)
    ).rejects.toMatchObject({ code: 'session_busy' });
    expect(await actions().getSessionReviews(scope, id)).toMatchObject([
      { state: 'confirmed', isError: null },
    ]);
  });
  it('refresh_and_confirm_reject_semantically_invalid_bodies_even_with_matching_hash', async () => {
    const { id, action } = await setup();
    const body = { name: 42 };
    await pool().query(
      sql`update ai_pending_actions set arguments = ${sql.jsonb(body)}, arguments_hash = ${hashBody(body)} where id = ${action.id}`
    );
    await expect(
      actions().refreshSessionReview(scope, id, action.id, action.id)
    ).rejects.toMatchObject({ code: 'revision_conflict' });
    await expect(confirm(action.id)).rejects.toMatchObject({ code: 'revision_conflict' });
  });
  it.each(['executed', 'cancelled', 'confirmed'] as const)(
    'refresh_cannot_revive_terminal_actions: %s',
    async (state) => {
      const { id, action } = await setup();
      await pool().query(
        sql`update ai_pending_actions set state = ${state} where id = ${action.id}`
      );
      await expect(
        actions().refreshSessionReview(scope, id, action.id, action.id)
      ).rejects.toMatchObject({
        code: state === 'confirmed' ? 'session_busy' : 'revision_conflict',
      });
    }
  );
};

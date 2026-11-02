import { randomUUID } from 'node:crypto';

import { type ChatScope, type CreateTurnInput } from '@logto/schemas';
import { type DatabasePool, sql } from '@silverhand/slonik';

import { proposePendingAction } from './ai-chat-actions.js';
import { createTurnProposalStore } from './ai-chat-session-proposals.js';
import { proposalTests } from './ai-chat-session-proposals.test-helper.js';
import { createChatSessionStore } from './ai-chat-session-store.js';
import { deferred } from './ai-chat-session-turn-safety.test-helper.js';
import { createChatTurnStore } from './ai-chat-session-turn-store.js';
import { runSessionTurn, type SessionRunner } from './ai-chat-session-turns.js';

const { jest } = import.meta;

export const sessionRunTests = (pool: () => DatabasePool, scope: ChatScope) => {
  proposalTests(pool, scope);
  const setup = async () => {
    const sessions = createChatSessionStore(pool());
    const session = await sessions.create(scope, randomUUID());
    const turns = createChatTurnStore(pool());
    const input: CreateTurnInput = {
      requestId: randomUUID(),
      expectedTranscriptRevision: 0,
      composerRevision: 0,
      text: 'current question',
      attachments: [],
    };
    const runner = jest
      .fn<ReturnType<SessionRunner>, Parameters<SessionRunner>>()
      .mockResolvedValue({ ok: true, content: 'answer' });
    const options = {
      scope,
      sessionId: session.id,
      input,
      credentials: { apiKey: 'never-persist-this' },
      store: {
        turns,
        sessions,
        propose: (turnId: string, leaseToken: string) =>
          createTurnProposalStore(pool(), scope, session.id, turnId, leaseToken),
      },
      runner,
    };
    return { sessions, turns, options, runner, id: session.id };
  };
  it('request_retry_does_not_call_model_twice_and_disconnect_read_never_replays', async () => {
    const { options, runner, turns, id } = await setup();
    const completed = await runSessionTurn(options);
    expect(completed.state).toBe('completed');
    expect(await runSessionTurn(options)).toEqual(completed);
    expect(await turns.get(scope, id, options.input.requestId)).toEqual(completed);
    expect(runner).toHaveBeenCalledTimes(1);
  });
  it('running_request_retry_returns_status_without_calling_runner_again', async () => {
    const { options, runner } = await setup();
    const entered = deferred();
    const release = deferred();
    runner.mockImplementation(async () => {
      entered.resolve();
      await release.promise;
      return { ok: true, content: 'answer' };
    });
    const running = runSessionTurn(options);
    await entered.promise;
    try {
      expect(await runSessionTurn(options)).toMatchObject({ state: 'running' });
      expect(runner).toHaveBeenCalledTimes(1);
    } finally {
      release.resolve();
    }
    expect(await running).toMatchObject({ state: 'completed' });
  });
  it.each([true, false])('proposals stay hidden until completion; ok=%s', async (ok) => {
    const { options, runner, sessions, id } = await setup();
    runner.mockImplementation(async ({ propose }) => {
      const proposal = await proposePendingAction({
        store: propose,
        tool: 'create_organization',
        args: { name: 'Example' },
        ...scope,
        now: new Date(),
      });
      expect(proposal.ok).toBe(true);
      const page = await sessions.messages(scope, id);
      expect(page.items[0]?.reviews).toEqual([]);
      return { ok, content: 'answer' };
    });
    const result = await runSessionTurn(options);
    expect(result.state).toBe(ok ? 'completed' : 'failed');
    const page = await sessions.messages(scope, id);
    expect(page.items.at(-1)?.reviews).toHaveLength(ok ? 1 : 0);
    const stored = await pool()
      .one(sql`select a.state, a.arguments, a.result from ai_pending_actions a
      join ai_chat_review_links l on a.id = l.current_action_id where l.session_id = ${id}`);
    expect(stored).toEqual({
      state: ok ? 'pending' : 'cancelled',
      arguments: { name: 'Example' },
      result: null,
    });
    expect(JSON.stringify(stored)).not.toContain('never-persist-this');
  });
  it('session_history_is_server_owned_and_credentials_are_never_stored', async () => {
    const { options, runner, sessions, id } = await setup();
    await runSessionTurn(options);
    expect(runner.mock.calls[0]?.[0].messages).toEqual([
      { role: 'user', content: 'current question' },
    ]);
    const rows = await pool().any(
      sql`select row_to_json(t)::text as value from ai_chat_turns t where session_id = ${id}`
    );
    expect(JSON.stringify(rows)).not.toContain('never-persist-this');
    const page = await sessions.messages(scope, id);
    expect(page.items.map(({ content }) => content)).toEqual(['current question', 'answer']);
  });
  it('missing_api_key_fails_before_claiming_user_work', async () => {
    const { options, sessions, id, runner } = await setup();
    await expect(runSessionTurn({ ...options, credentials: { apiKey: '' } })).rejects.toMatchObject(
      { code: 'ai_chat_not_configured' }
    );
    const page = await sessions.messages(scope, id);
    expect(page.items).toEqual([]);
    expect(runner).not.toHaveBeenCalled();
  });
  it('over_limit_response_fails_without_persisting_output', async () => {
    const { options, runner, sessions, id } = await setup();
    runner.mockResolvedValue({ ok: true, content: 'x'.repeat(8001) });
    expect(await runSessionTurn(options)).toMatchObject({
      state: 'failed',
      errorCode: 'content_limit',
    });
    const page = await sessions.messages(scope, id);
    expect(page.items).toHaveLength(1);
  });
  it('current_message_survives_context_windowing_with_visible_disclosure', async () => {
    const { options, sessions, id, runner } = await setup();
    const historyTurn = randomUUID().slice(0, 21);
    await pool().query(sql`insert into ai_chat_turns
      (id, tenant_id, user_id, session_id, request_id, state)
      values (${historyTurn}, ${scope.tenantId}, ${scope.userId}, ${id}, ${randomUUID()}, 'completed')`);
    await pool().query(sql`insert into ai_chat_messages
      (id, tenant_id, user_id, session_id, turn_id, sequence, role, content)
      select 'history-' || n, ${scope.tenantId}, ${scope.userId}, ${id}, ${historyTurn}, n, 'user', 'old-' || n
      from generate_series(1, 45) n`);
    await pool().query(
      sql`update ai_chat_sessions set next_sequence = 46, message_count = 45, transcript_revision = 45 where id = ${id}`
    );
    await runSessionTurn({
      ...options,
      input: { ...options.input, expectedTranscriptRevision: 45 },
    });
    const messages = runner.mock.calls[0]?.[0].messages ?? [];
    expect(messages.filter(({ role }) => role === 'user')).toHaveLength(40);
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'current question' });
    const page = await sessions.messages(scope, id);
    expect(page.items.at(-1)?.content).toContain('Older history');
  });
};

import { randomUUID } from 'node:crypto';

import { type ChatScope } from '@logto/schemas';
import { type DatabasePool, sql } from '@silverhand/slonik';

import { createChatSessionStore } from './ai-chat-session-store.js';

export const lifecycleTests = (pool: () => DatabasePool, scope: ChatScope) => {
  const setup = async () => {
    const api = createChatSessionStore(pool());
    return { api, session: await api.create(scope, randomUUID()) };
  };

  it('archived_session_rejects_mutation_until_restored', async () => {
    const { api, session } = await setup();
    const archived = await api.update(scope, session.id, { expectedRevision: 0, archived: true });
    expect(archived.revision).toBe(1);
    await expect(
      api.update(scope, session.id, { expectedRevision: 1, title: 'No' })
    ).rejects.toMatchObject({ code: 'session_archived' });
    await expect(
      api.saveComposer(scope, session.id, { expectedRevision: 0, text: 'draft', attachments: [] })
    ).rejects.toMatchObject({ code: 'session_archived' });
    await api.update(scope, session.id, { expectedRevision: 1, archived: false });
    expect(
      await api.saveComposer(scope, session.id, {
        expectedRevision: 0,
        text: 'draft',
        attachments: [],
      })
    ).toMatchObject({ revision: 1, text: 'draft' });
    expect(await api.get(scope, session.id)).toMatchObject({ revision: 2, transcriptRevision: 0 });
  });

  it('composer_conflict_preserves_server_value', async () => {
    const { api, session } = await setup();
    const results = await Promise.allSettled(
      ['first', 'second'].map(async (text) =>
        api.saveComposer(scope, session.id, { expectedRevision: 0, text, attachments: [] })
      )
    );
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.find(({ status }) => status === 'rejected')).toMatchObject({
      reason: { code: 'revision_conflict', currentRevision: 1 },
    });
    const winner = results.find((result) => result.status === 'fulfilled');
    expect(await api.getComposer(scope, session.id)).toEqual(winner?.value);
    await expect(api.remove(scope, session.id, 1)).rejects.toMatchObject({
      code: 'revision_conflict',
      currentRevision: 0,
    });
  });

  it('title_search_treats_percent_and_underscore_literally', async () => {
    const { api, session } = await setup();
    await api.update(scope, session.id, { expectedRevision: 0, title: 'literal %_ title' });
    const page = await api.list(scope, { archived: false, search: '%_' });
    expect(page.items.map(({ id }) => id)).toEqual([session.id]);
  });

  it('delete_conflicts_with_active_operation', async () => {
    const { api, session } = await setup();
    await pool().query(
      sql`update ai_chat_operations set kind = 'generation', lease_expires_at = now() + interval '1 minute' where session_id = ${session.id}`
    );
    await expect(api.remove(scope, session.id, 0)).rejects.toMatchObject({ code: 'session_busy' });
    await expect(
      api.update(scope, session.id, { expectedRevision: 0, archived: true })
    ).rejects.toMatchObject({ code: 'session_busy' });
    await pool().query(
      sql`update ai_chat_operations set lease_expires_at = now() - interval '1 second' where session_id = ${session.id}`
    );
    await api.update(scope, session.id, { expectedRevision: 0, archived: true });
    expect(
      await pool().one(
        sql`select kind, revision from ai_chat_operations where session_id = ${session.id}`
      )
    ).toEqual({ kind: null, revision: 1 });
    await api.remove(scope, session.id, 1);
  });

  it('delete_cancels_pending_reviews_but_preserves_executed_audit', async () => {
    const { api, session } = await setup();
    const pending = randomUUID().slice(0, 21);
    const executed = randomUUID().slice(0, 21);
    const confirmed = randomUUID().slice(0, 21);
    const ids = [pending, executed, confirmed];
    await Promise.all(
      [
        { id: pending, state: 'pending' },
        { id: executed, state: 'executed' },
        { id: confirmed, state: 'confirmed' },
      ].map(async ({ id, state }) => {
        await pool().query(
          sql`insert into ai_pending_actions (id,tenant_id,user_id,tool,arguments,arguments_hash,state,expires_at) values (${id},${scope.tenantId},${scope.userId},'test','{"keep":"audit"}','hash',${state},now() + interval '1 day')`
        );
        await pool().query(
          sql`insert into ai_chat_review_links (id,tenant_id,user_id,session_id,original_action_id,current_action_id) values (${id},${scope.tenantId},${scope.userId},${session.id},${id},${id})`
        );
      })
    );
    await expect(api.remove(scope, session.id, 0)).rejects.toMatchObject({ code: 'session_busy' });
    await pool().query(
      sql`update ai_pending_actions set state = 'executed' where id = ${confirmed}`
    );
    const audit = await pool().one(sql`select * from ai_pending_actions where id = ${executed}`);
    await api.remove(scope, session.id, 0);
    expect(await pool().one(sql`select * from ai_pending_actions where id = ${executed}`)).toEqual(
      audit
    );
    expect(
      await pool().oneFirst(sql`select state from ai_pending_actions where id = ${pending}`)
    ).toBe('cancelled');
    expect(
      await pool().any(
        sql`select session_id from ai_chat_review_links where id = any(${sql.array(ids, 'text')})`
      )
    ).toEqual(ids.map(() => ({ session_id: null })));
  });

  it('limits_do_not_prevent_read_or_delete', async () => {
    const { api, session } = await setup();
    await api.saveComposer(scope, session.id, {
      expectedRevision: 0,
      text: 'keep',
      attachments: [],
    });
    await pool().query(
      sql`update ai_chat_sessions set stored_bytes = 8388608, message_count = 2000 where id = ${session.id}`
    );
    await expect(
      api.saveComposer(scope, session.id, { expectedRevision: 1, text: 'larger', attachments: [] })
    ).rejects.toMatchObject({ code: 'content_limit' });
    expect(await api.getComposer(scope, session.id)).toMatchObject({ text: 'keep', revision: 1 });
    expect(await api.get(scope, session.id)).toBeDefined();
    await api.remove(scope, session.id, 0);
    expect(await api.get(scope, session.id)).toBeUndefined();
  });

  it('lifecycle_methods_hide_missing_and_foreign_owners', async () => {
    const { api, session } = await setup();
    const stranger = { ...scope, userId: 'stranger-lifecycle' };
    await expect(
      api.update(stranger, session.id, { expectedRevision: 0, title: 'No' })
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(api.remove(stranger, session.id, 0)).rejects.toMatchObject({ code: 'not_found' });
    await expect(api.getComposer(stranger, session.id)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      api.saveComposer(stranger, session.id, { expectedRevision: 0, text: '', attachments: [] })
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('expired_generation_is_interrupted_and_fenced_without_transcript_replay', async () => {
    const { api, session } = await setup();
    const turnId = randomUUID().slice(0, 21);
    await pool().query(
      sql`insert into ai_chat_turns (id,tenant_id,user_id,session_id,request_id) values (${turnId},${scope.tenantId},${scope.userId},${session.id},${randomUUID()})`
    );
    await pool().query(
      sql`update ai_chat_operations set kind = 'generation', turn_id = ${turnId}, lease_owner = 'worker', lease_token = 'secret', lease_expires_at = now() - interval '1 second' where session_id = ${session.id}`
    );
    await api.update(scope, session.id, { expectedRevision: 0, archived: true });
    expect(
      await pool().one(
        sql`select state, error_code, completed_at is not null as completed from ai_chat_turns where id = ${turnId}`
      )
    ).toEqual({ state: 'interrupted', error_code: 'lease_expired', completed: true });
    expect(
      await pool().one(
        sql`select kind, revision, lease_owner, lease_token from ai_chat_operations where session_id = ${session.id}`
      )
    ).toEqual({ kind: null, revision: 1, lease_owner: null, lease_token: null });
    expect(await api.messages(scope, session.id)).toEqual({ items: [], nextCursor: null });
    expect(await api.get(scope, session.id)).toMatchObject({ revision: 1, transcriptRevision: 0 });
  });

  it('composer_byte_delta_counts_utf8_attachment_names_and_preserves_other_reservations', async () => {
    const { api, session } = await setup();
    const input = {
      expectedRevision: 0,
      text: 'é',
      attachments: [{ id: 'attachment', name: '文', text: '💡' }],
    };
    await pool().query(
      sql`update ai_chat_sessions set stored_bytes = 100 where id = ${session.id}`
    );
    await api.saveComposer(scope, session.id, input);
    expect(
      await pool().oneFirst(sql`select stored_bytes from ai_chat_sessions where id = ${session.id}`)
    ).toBe(109);
    await api.saveComposer(scope, session.id, { expectedRevision: 1, text: 'a', attachments: [] });
    expect(
      await pool().oneFirst(sql`select stored_bytes from ai_chat_sessions where id = ${session.id}`)
    ).toBe(101);
    await expect(
      api.update(scope, session.id, { expectedRevision: 1, title: 'stale' })
    ).rejects.toMatchObject({ code: 'revision_conflict', currentRevision: 0 });
  });
};

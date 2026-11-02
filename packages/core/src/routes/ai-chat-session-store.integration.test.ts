/* eslint-disable @silverhand/fp/no-let, @silverhand/fp/no-mutation, no-await-in-loop -- Database fixture setup and teardown are ordered, mutable lifecycle operations. */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { type ChatScope } from '@logto/schemas';
import { createPool, type DatabasePool, sql } from '@silverhand/slonik';

import { lifecycleTests } from './ai-chat-session-lifecycle.test-helper.js';
import {
  createChatSessionStore,
  ChatSessionStoreError,
  type ChatSessionStore,
} from './ai-chat-session-store.js';
import { turnTests } from './ai-chat-session-turn.test-helper.js';

const store = { createChatSessionStore };
// Opt in explicitly. Never fall back to the application's database configuration.
const databaseUrl = process.env.AI_CHAT_TEST_DATABASE_URL;
if (databaseUrl) {
  const url = new URL(databaseUrl);
  if (
    url.hostname !== '127.0.0.1' ||
    !['52969', '52970'].includes(url.port) ||
    !url.pathname.endsWith('_ai_chat_test') ||
    url.username !== 'postgres' ||
    url.password !== 'local-test-only'
  ) {
    throw new Error('Unsafe AI_CHAT_TEST_DATABASE_URL: disposable local test database required');
  }
}

const integration = databaseUrl ? describe : describe.skip;
integration('private chat PostgreSQL storage', () => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const schema = `chat_test_${suffix}`;
  const roles = [`chat_a_${suffix}`, `chat_b_${suffix}`];
  // Match the migration's database-scoped role, not one developer's fixture database name.
  const baseRole = `logto_tenant_${databaseUrl ? new URL(databaseUrl).pathname.slice(1).replaceAll('-', '_') : 'unused'}`;
  let createdBaseRole = false;
  const scope: ChatScope = { tenantId: 'tenant-a', userId: 'user-a' };
  let admin: DatabasePool;
  let owner: DatabasePool;
  let other: DatabasePool;
  let migration: {
    up: (pool: DatabasePool) => Promise<void>;
    down: (pool: DatabasePool) => Promise<void>;
  };

  const connect = async (role?: string) => {
    return createPool(databaseUrl!, {
      interceptors: [
        {
          afterPoolConnection: async (_, connection) => {
            await connection.query(sql`set search_path to ${sql.identifier([schema])}`);
            if (role) {
              await connection.query(sql`set role ${sql.identifier([role])}`);
            }
            return null;
          },
        },
      ],
    });
  };

  beforeAll(async () => {
    admin = await createPool(databaseUrl!);
    await admin.query(sql`create schema ${sql.identifier([schema])}`);
    await admin.end();
    admin = await connect();
    if (!(await admin.maybeOne(sql`select 1 from pg_roles where rolname = ${baseRole}`))) {
      await admin.query(sql`create role ${sql.identifier([baseRole])}`);
      createdBaseRole = true;
    }
    for (const role of roles) {
      await admin.query(sql`create role ${sql.identifier([role])}`);
      await admin.query(sql`grant ${sql.identifier([baseRole])} to ${sql.identifier([role])}`);
      await admin.query(
        sql`grant usage on schema ${sql.identifier([schema])} to ${sql.identifier([role])}`
      );
    }
    await admin.query(sql`create table tenants (id varchar(21) primary key, db_user text unique)`);
    await admin.query(
      sql`insert into tenants values ('tenant-a', ${roles[0]!}), ('tenant-b', ${roles[1]!})`
    );
    await admin.query(
      sql`grant select on tenants to ${sql.identifier([roles[0]!])}, ${sql.identifier([roles[1]!])}`
    );
    const functions = await readFile(
      new URL('../../../schemas/tables/_functions.sql', import.meta.url),
      'utf8'
    );
    await admin.query(sql.raw(functions));
    const pending = await readFile(
      new URL('../../../schemas/tables/ai_pending_actions.sql', import.meta.url),
      'utf8'
    );
    await admin.query(sql.raw(pending));
    const policies = await readFile(
      new URL('../../../schemas/tables/_after_each.sql', import.meta.url),
      'utf8'
    );
    // eslint-disable-next-line no-template-curly-in-string -- Literal placeholder in the shared SQL template.
    await admin.query(sql.raw(policies.replaceAll('${name}', 'ai_pending_actions')));
    await admin.query(
      sql`grant select, insert, update, delete on ai_pending_actions to ${sql.identifier([baseRole])}`
    );
    // Simulate the pre-migration table, with an existing audit record.
    await admin.query(
      sql`alter table ai_pending_actions drop constraint ai_pending_actions_chat_owner`
    );
    await admin.query(sql`
      insert into ai_pending_actions (id,tenant_id,user_id,tool,arguments,arguments_hash,expires_at)
      values ('audit', 'tenant-a', 'user-a', 'test', '{"keep":"audit"}', 'hash', now() + interval '1 day');
    `);
    // Load the built, real additive migration, not a copy of its SQL.
    const migrationPath = '../../../schemas/alterations-js/1.46.0-1793620000-ai-chat-sessions.js';
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- The compiled local alteration has this standard interface.
    const module: { default: typeof migration } = await import(migrationPath);
    migration = module.default;
    await migration.up(admin);
    owner = await connect(roles[0]);
    other = await connect(roles[1]);
  });

  afterAll(async () => {
    // BeforeAll may fail before either role pool exists.
    // eslint-disable-next-line unicorn/no-typeof-undefined -- These lifecycle variables can be uninitialized if setup fails.
    if (typeof owner !== 'undefined') {
      await owner.end();
    }
    // eslint-disable-next-line unicorn/no-typeof-undefined -- See setup failure handling above.
    if (typeof other !== 'undefined') {
      await other.end();
    }
    // eslint-disable-next-line unicorn/no-typeof-undefined -- See setup failure handling above.
    if (typeof admin !== 'undefined') {
      await admin.query(sql`drop schema ${sql.identifier([schema])} cascade`);
      for (const role of roles) {
        await admin.query(sql`drop role if exists ${sql.identifier([role])}`);
      }
      if (createdBaseRole) {
        await admin.query(sql`drop role ${sql.identifier([baseRole])}`);
      }
      await admin.end();
    }
  });

  it('tenant_role_cannot_see_other_tenant', async () => {
    expect(await owner.oneFirst(sql`select current_user`)).toBe(roles[0]);
    expect(
      await owner.one(sql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`)
    ).toEqual({ rolsuper: false, rolbypassrls: false });
    const session = await store.createChatSessionStore(owner).create(scope, randomUUID());
    expect(await other.any(sql`select id from ai_chat_sessions where id = ${session.id}`)).toEqual(
      []
    );
    expect(await store.createChatSessionStore(other).get(scope, session.id)).toBeUndefined();
    const ownSession = await store
      .createChatSessionStore(other)
      .create({ tenantId: 'tenant-b', userId: 'user-a' }, randomUUID());
    expect(await store.createChatSessionStore(owner).get(scope, ownSession.id)).toBeUndefined();
    await expect(
      other.query(
        sql`insert into ai_chat_sessions (id,tenant_id,user_id,creation_request_id) values ('forged', 'tenant-a', 'user-a', ${randomUUID()})`
      )
    ).rejects.toThrow();
  });

  it('same_tenant_other_user_gets_no_history', async () => {
    const api: ChatSessionStore = store.createChatSessionStore(owner);
    const session = await api.create(scope, randomUUID());
    await owner.query(
      sql`insert into ai_chat_turns (id,tenant_id,user_id,session_id,request_id) values ('owned-turn','tenant-a','user-a',${session.id},${randomUUID()})`
    );
    await owner.query(
      sql`insert into ai_chat_messages (id,tenant_id,user_id,session_id,turn_id,sequence,role,content) values ('owned-message','tenant-a','user-a',${session.id},'owned-turn',1,'user','private history')`
    );
    const ownedHistory = await api.messages(scope, session.id);
    expect(ownedHistory.items).toHaveLength(1);
    const stranger = { ...scope, userId: 'stranger' };
    expect(await api.get(stranger, session.id)).toBeUndefined();
    expect(await api.messages(stranger, session.id)).toEqual({ items: [], nextCursor: null });
    const page = await api.list(stranger, { archived: false });
    expect(page.items).toEqual([]);
    expect(
      await owner.oneFirst(
        sql`select revision from ai_chat_composers where session_id = ${session.id}`
      )
    ).toBe(0);
  });

  it('duplicate_creation_id_returns_same_session', async () => {
    const api = store.createChatSessionStore(owner);
    const requestId = randomUUID();
    const sessions = await Promise.all([
      api.create(scope, requestId),
      api.create(scope, requestId),
    ]);
    expect(sessions[0]).toEqual(sessions[1]);
  });

  it('foreign_owner_link_is_rejected', async () => {
    const session = await store.createChatSessionStore(owner).create(scope, randomUUID());
    await expect(
      owner.query(
        sql`insert into ai_chat_turns (id,tenant_id,user_id,session_id,request_id) values ('foreign-turn','tenant-a','stranger',${session.id},${randomUUID()})`
      )
    ).rejects.toThrow();
    await expect(
      owner.query(
        sql`insert into ai_chat_review_links (id,tenant_id,user_id,session_id,original_action_id,current_action_id) values ('foreign-link','tenant-a','stranger',${session.id},'audit','audit')`
      )
    ).rejects.toThrow();
    const strangerSession = await store
      .createChatSessionStore(owner)
      .create({ ...scope, userId: 'stranger' }, randomUUID());
    await expect(
      owner.query(
        sql`insert into ai_chat_review_links (id,tenant_id,user_id,session_id,original_action_id,current_action_id) values ('foreign-action','tenant-a','stranger',${strangerSession.id},'audit','audit')`
      )
    ).rejects.toThrow();
  });

  it('quota_is_serialized_and_idempotent_retry_still_works_at_capacity', async () => {
    const api = store.createChatSessionStore(owner);
    const capped = { ...scope, userId: 'at-capacity' };
    const requestId = randomUUID();
    const existing = await api.create(capped, requestId);
    await owner.query(
      sql`insert into ai_chat_sessions (id,tenant_id,user_id,creation_request_id) select 'quota-' || n,'tenant-a','at-capacity',gen_random_uuid() from generate_series(1,198) n`
    );
    const results = await Promise.allSettled([
      api.create(capped, randomUUID()),
      api.create(capped, randomUUID()),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({ reason: new ChatSessionStoreError('content_limit') });
    expect(await api.create(capped, requestId)).toEqual(existing);
    expect(
      await owner.oneFirst(
        sql`select count(*)::integer from ai_chat_sessions where user_id = 'at-capacity'`
      )
    ).toBe(200);
  });

  it('history_cursor_has_no_duplicates_for_equal_timestamps', async () => {
    const api = store.createChatSessionStore(owner);
    const isolated = { ...scope, userId: 'pagination' };
    const sessions = await Promise.all(
      Array.from({ length: 32 }, async () => api.create(isolated, randomUUID()))
    );
    await owner.query(
      sql`update ai_chat_sessions set updated_at = '2026-01-01T00:00:00.123456Z' where user_id = 'pagination'`
    );
    const first = await api.list(isolated, { archived: false });
    const second = await api.list(isolated, { archived: false, cursor: first.nextCursor! });
    expect(first.items).toHaveLength(30);
    expect(second.items).toHaveLength(2);
    expect(new Set([...first.items, ...second.items].map(({ id }) => id)).size).toBe(
      sessions.length
    );
    const session = sessions[0]!;
    await owner.query(
      sql`insert into ai_chat_turns (id,tenant_id,user_id,session_id,request_id) values ('page-turn','tenant-a','pagination',${session.id},${randomUUID()})`
    );
    await owner.query(
      sql`insert into ai_chat_messages (id,tenant_id,user_id,session_id,turn_id,sequence,role,content) select 'message-' || n,'tenant-a','pagination',${session.id},'page-turn',n,'user','hello' from generate_series(1, 52) n`
    );
    const messages = await api.messages(isolated, session.id);
    const older = await api.messages(isolated, session.id, messages.nextCursor ?? undefined);
    expect(messages.items.map(({ sequence }) => sequence)).toEqual(
      Array.from({ length: 50 }, (_, index) => index + 3)
    );
    expect(older.items.map(({ sequence }) => sequence)).toEqual([1, 2]);
  });

  it('search_is_literal_and_archive_filter_is_independent', async () => {
    const api = store.createChatSessionStore(owner);
    const session = await api.create(scope, randomUUID());
    await owner.query(
      sql`update ai_chat_sessions set title = '100%_\\ literal', archived_at = now() where id = ${session.id}`
    );
    const archived = await api.list(scope, { archived: true, search: '%_\\' });
    const active = await api.list(scope, { archived: false, search: '%_\\' });
    expect(archived.items.map(({ id }) => id)).toEqual([session.id]);
    expect(active.items).toEqual([]);
    await expect(api.list(scope, { archived: false, cursor: 'invalid' })).rejects.toThrow();
  });

  it('deletion_retains_only_review_ownership_and_action_ids', async () => {
    const session = await store.createChatSessionStore(owner).create(scope, randomUUID());
    await owner.query(
      sql`insert into ai_chat_turns (id,tenant_id,user_id,session_id,request_id) values ('delete-turn','tenant-a','user-a',${session.id},${randomUUID()})`
    );
    await owner.query(
      sql`insert into ai_chat_messages (id,tenant_id,user_id,session_id,turn_id,sequence,role,content) values ('delete-message','tenant-a','user-a',${session.id},'delete-turn',1,'assistant','private text')`
    );
    await owner.query(
      sql`insert into ai_chat_review_links (id,tenant_id,user_id,session_id,message_id,turn_id,original_action_id,current_action_id) values ('delete-review','tenant-a','user-a',${session.id},'delete-message','delete-turn','audit','audit')`
    );
    await owner.query(
      sql`update ai_pending_actions set result = '{"isError":true,"secret":"must not leak"}' where id = 'audit'`
    );
    const history = await store.createChatSessionStore(owner).messages(scope, session.id);
    expect(history.items[0]?.reviews[0]).toMatchObject({
      originalActionId: 'audit',
      body: { keep: 'audit' },
      isError: true,
    });
    expect(JSON.stringify(history)).not.toContain('must not leak');
    expect(
      await other.any(sql`select id from ai_chat_messages where id = 'delete-message'`)
    ).toEqual([]);
    expect(
      await other.any(sql`select id from ai_chat_review_links where id = 'delete-review'`)
    ).toEqual([]);
    expect(await other.any(sql`select id from ai_chat_turns where id = 'delete-turn'`)).toEqual([]);
    expect(
      await other.any(
        sql`select session_id from ai_chat_composers where session_id = ${session.id}`
      )
    ).toEqual([]);
    expect(
      await other.any(
        sql`select session_id from ai_chat_operations where session_id = ${session.id}`
      )
    ).toEqual([]);
    // Composite owner keys stay non-null; only the session's before-delete trigger detaches reviews.
    await expect(
      owner.query(sql`delete from ai_chat_messages where id = 'delete-message'`)
    ).rejects.toThrow();
    await expect(
      owner.query(sql`delete from ai_chat_turns where id = 'delete-turn'`)
    ).rejects.toThrow();
    await owner.query(sql`delete from ai_chat_sessions where id = ${session.id}`);
    expect(
      await owner.one(
        sql`select session_id, message_id, turn_id, original_action_id, current_action_id, deleted_session_at is not null as tombstone from ai_chat_review_links where id = 'delete-review'`
      )
    ).toEqual({
      session_id: null,
      message_id: null,
      turn_id: null,
      original_action_id: 'audit',
      current_action_id: 'audit',
      tombstone: true,
    });
    expect(
      await owner.any(sql`select id from ai_chat_messages where id = 'delete-message'`)
    ).toEqual([]);
    expect(await owner.any(sql`select id from ai_chat_turns where id = 'delete-turn'`)).toEqual([]);
    expect(
      await owner.any(
        sql`select session_id from ai_chat_composers where session_id = ${session.id}`
      )
    ).toEqual([]);
    expect(
      await owner.any(
        sql`select session_id from ai_chat_operations where session_id = ${session.id}`
      )
    ).toEqual([]);
    expect(
      await admin.oneFirst(sql`select arguments from ai_pending_actions where id = 'audit'`)
    ).toEqual({ keep: 'audit' });
  });

  lifecycleTests(() => owner, scope);
  turnTests(() => owner, scope);

  it('migration_down_up_preserves_existing_actions', async () => {
    const audit = await admin.one(sql`select * from ai_pending_actions where id = 'audit'`);
    await admin.query(sql`delete from ai_chat_sessions; delete from ai_chat_review_links`);
    await migration.down(admin);
    await migration.up(admin);
    expect(await admin.one(sql`select * from ai_pending_actions where id = 'audit'`)).toEqual(
      audit
    );
    expect(
      await admin.oneFirst(sql`select arguments from ai_pending_actions where id = 'audit'`)
    ).toEqual({ keep: 'audit' });
  });
  it('fresh_table_definitions_match_the_immutable_migration', async () => {
    const tables = [
      'ai_chat_sessions',
      'ai_chat_turns',
      'ai_chat_messages',
      'ai_chat_composers',
      'ai_chat_operations',
      'ai_chat_review_links',
    ];
    const snapshot = async () =>
      admin.any(sql`
      select c.relname, a.attname, format_type(a.atttypid, a.atttypmod) as type, a.attnotnull,
        pg_get_expr(d.adbin, d.adrelid) as default_expression
      from pg_class c join pg_attribute a on a.attrelid = c.oid
      left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
      where c.relnamespace = ${schema}::regnamespace and c.relname = any(${sql.array(tables, 'text')})
        and a.attnum > 0 and not a.attisdropped order by c.relname, a.attname
    `);
    const constraints = async () =>
      admin.any(sql`
      select c.relname, pg_get_constraintdef(k.oid) as definition
      from pg_constraint k join pg_class c on c.oid = k.conrelid
      where c.relnamespace = ${schema}::regnamespace and c.relname = any(${sql.array(tables, 'text')})
      order by c.relname, definition
    `);
    const migrated = await snapshot();
    const migratedConstraints = await constraints();
    await migration.down(admin);
    await admin.query(
      sql`alter table ai_pending_actions add constraint ai_pending_actions_chat_owner unique (tenant_id,user_id,id)`
    );
    const policies = await readFile(
      new URL('../../../schemas/tables/_after_each.sql', import.meta.url),
      'utf8'
    );
    for (const table of tables) {
      const source = await readFile(
        new URL(`../../../schemas/tables/${table}.sql`, import.meta.url),
        'utf8'
      );
      await admin.query(sql.raw(source));
      // eslint-disable-next-line no-template-curly-in-string -- Literal placeholder in the shared SQL template.
      await admin.query(sql.raw(policies.replaceAll('${name}', table)));
    }
    expect(await snapshot()).toEqual(migrated);
    expect(await constraints()).toEqual(migratedConstraints);
  });
});
/* eslint-enable @silverhand/fp/no-let, @silverhand/fp/no-mutation, no-await-in-loop */

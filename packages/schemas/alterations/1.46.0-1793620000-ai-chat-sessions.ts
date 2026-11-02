import { sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

// Unreleased migration snapshot; keep initial-table SQL aligned until release.
// After release, future schema changes belong in a new alteration.
const tables = [
  'ai_chat_sessions',
  'ai_chat_turns',
  'ai_chat_messages',
  'ai_chat_composers',
  'ai_chat_operations',
  'ai_chat_review_links',
] as const;

const alteration: AlterationScript = {
  up: async (pool) => {
    const database = await pool.oneFirst<string>(sql`select current_database()`);
    const baseRole = sql.identifier([`logto_tenant_${database.replaceAll('-', '_')}`]);
    await pool.query(
      sql`alter table ai_pending_actions add constraint ai_pending_actions_chat_owner unique (tenant_id, user_id, id)`
    );
    await pool.query(sql`
      create table ai_chat_sessions (
        id varchar(21) not null primary key,
        tenant_id varchar(21) not null references tenants (id) on update cascade on delete cascade,
        user_id varchar(21) not null,
        creation_request_id uuid not null,
        title text not null default 'New conversation',
        archived_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        revision integer not null default 0 check (revision >= 0),
        transcript_revision integer not null default 0 check (transcript_revision >= 0),
        next_sequence integer not null default 1 check (next_sequence > 0),
        stored_bytes bigint not null default 0 check (stored_bytes >= 0),
        message_count integer not null default 0 check (message_count >= 0),
        unique (tenant_id, user_id, id),
        unique (tenant_id, user_id, creation_request_id),
        check (char_length(title) between 1 and 120)
      );
      create index ai_chat_sessions__owner_list on ai_chat_sessions
        (tenant_id, user_id, (archived_at is not null), updated_at desc, id desc);

      create table ai_chat_turns (
        id varchar(21) not null primary key,
        tenant_id varchar(21) not null,
        user_id varchar(21) not null,
        session_id varchar(21) not null,
        request_id uuid not null,
        input_hash text not null default '',
        lease_token text,
        reserved_bytes integer not null default 0 check (reserved_bytes >= 0),
        reserved_messages integer not null default 0 check (reserved_messages >= 0),
        state text not null default 'running' check (state in ('running', 'completed', 'failed', 'interrupted')),
        error_code text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        completed_at timestamptz,
        unique (tenant_id, user_id, session_id, id),
        unique (tenant_id, user_id, session_id, request_id),
        foreign key (tenant_id, user_id, session_id) references ai_chat_sessions (tenant_id, user_id, id) on delete cascade
      );
      create table ai_chat_messages (
        id varchar(21) not null primary key,
        tenant_id varchar(21) not null,
        user_id varchar(21) not null,
        session_id varchar(21) not null,
        turn_id varchar(21) not null,
        sequence integer not null check (sequence > 0),
        role text not null check (role in ('user', 'assistant')),
        content text not null check (char_length(content) > 0 and octet_length(content) <= 32768),
        created_at timestamptz not null default now(),
        unique (tenant_id, user_id, session_id, id),
        unique (tenant_id, user_id, session_id, sequence),
        foreign key (tenant_id, user_id, session_id) references ai_chat_sessions (tenant_id, user_id, id) on delete cascade,
        foreign key (tenant_id, user_id, session_id, turn_id) references ai_chat_turns (tenant_id, user_id, session_id, id) on delete cascade
      );
      create table ai_chat_composers (
        tenant_id varchar(21) not null,
        user_id varchar(21) not null,
        session_id varchar(21) not null primary key,
        revision integer not null default 0 check (revision >= 0),
        text text not null default '',
        attachments jsonb not null default '[]'::jsonb,
        updated_at timestamptz not null default now(),
        foreign key (tenant_id, user_id, session_id) references ai_chat_sessions (tenant_id, user_id, id) on delete cascade
      );
      create table ai_chat_operations (
        tenant_id varchar(21) not null,
        user_id varchar(21) not null,
        session_id varchar(21) not null primary key,
        revision integer not null default 0 check (revision >= 0),
        kind text check (kind in ('generation', 'approval')),
        turn_id varchar(21),
        lease_owner text,
        lease_token text,
        lease_expires_at timestamptz,
        heartbeat_at timestamptz,
        updated_at timestamptz not null default now(),
        foreign key (tenant_id, user_id, session_id) references ai_chat_sessions (tenant_id, user_id, id) on delete cascade,
        foreign key (tenant_id, user_id, session_id, turn_id) references ai_chat_turns (tenant_id, user_id, session_id, id) on delete cascade
      );
      create table ai_chat_review_links (
        id varchar(21) not null primary key,
        tenant_id varchar(21) not null references tenants (id) on delete cascade,
        user_id varchar(21) not null,
        session_id varchar(21),
        message_id varchar(21),
        turn_id varchar(21),
        original_action_id varchar(21) not null,
        current_action_id varchar(21) not null,
        previous_action_ids text[] not null default '{}',
        deleted_session_at timestamptz,
        check ((session_id is not null and deleted_session_at is null) or
          (session_id is null and message_id is null and turn_id is null and deleted_session_at is not null)),
        unique (tenant_id, user_id, original_action_id),
        foreign key (tenant_id, user_id, session_id) references ai_chat_sessions (tenant_id, user_id, id) on delete no action,
        foreign key (tenant_id, user_id, session_id, message_id) references ai_chat_messages (tenant_id, user_id, session_id, id) on delete no action,
        foreign key (tenant_id, user_id, session_id, turn_id) references ai_chat_turns (tenant_id, user_id, session_id, id) on delete no action,
        foreign key (tenant_id, user_id, original_action_id) references ai_pending_actions (tenant_id, user_id, id),
        foreign key (tenant_id, user_id, current_action_id) references ai_pending_actions (tenant_id, user_id, id)
      );
      create index ai_chat_review_links__message on ai_chat_review_links (tenant_id, user_id, session_id, message_id);
      create index ai_chat_review_links__current_action on ai_chat_review_links (tenant_id, user_id, current_action_id);
      -- PostgreSQL 14 cannot SET NULL only selected composite-key columns. Clear references before
      -- session cascades instead; direct deletion of a referenced message/turn remains prohibited.
      create function tombstone_ai_chat_reviews() returns trigger as
      $$ begin
        update ai_chat_review_links set session_id = null, message_id = null, turn_id = null,
          deleted_session_at = now()
          where tenant_id = old.tenant_id and user_id = old.user_id and session_id = old.id;
        return old;
      end; $$ language plpgsql;
      create trigger tombstone_ai_chat_reviews before delete on ai_chat_sessions
        for each row execute procedure tombstone_ai_chat_reviews();
    `);
    for (const table of tables) {
      const name = sql.identifier([table]);
      // eslint-disable-next-line no-await-in-loop -- Apply DDL in a deterministic order on the migration connection.
      await pool.query(sql`
        create trigger set_tenant_id before insert on ${name}
          for each row execute procedure set_tenant_id();
        alter table ${name} enable row level security;
        create policy ${sql.identifier([`${table}_tenant_id`])} on ${name}
          as restrictive using (tenant_id = (select id from tenants where db_user = current_user));
        create policy ${sql.identifier([`${table}_modification`])} on ${name} using (true);
        grant select, insert, update, delete on ${name} to ${baseRole};
      `);
    }
  },
  down: async (pool) => {
    await pool.query(sql`drop trigger tombstone_ai_chat_reviews on ai_chat_sessions`);
    await pool.query(sql`drop function tombstone_ai_chat_reviews()`);
    for (const table of tables.toReversed()) {
      // eslint-disable-next-line no-await-in-loop -- Foreign keys require reverse dependency order.
      await pool.query(sql`drop table ${sql.identifier([table])}`);
    }
    await pool.query(
      sql`alter table ai_pending_actions drop constraint ai_pending_actions_chat_owner`
    );
  },
};

export default alteration;

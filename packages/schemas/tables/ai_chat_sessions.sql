/* init_order = 4 */

/** Private, account-backed Ask AI conversation metadata. */
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

/* init_order = 5 */

/** Idempotent send records. Message IDs are derived from the owned message rows. */
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

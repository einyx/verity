/* init_order = 6 */

/** One shared generation/approval lease and fencing revision per session. */
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

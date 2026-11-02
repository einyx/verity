/* init_order = 6 */

/** Sanitized user/assistant text only; never raw tool transcripts or credentials. */
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

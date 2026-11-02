/* init_order = 5 */

/** Account-backed unsent text and accepted text attachments. */
create table ai_chat_composers (
  tenant_id varchar(21) not null,
  user_id varchar(21) not null,
  session_id varchar(21) not null primary key,
  revision integer not null default 0 check (revision >= 0),
  text text not null default '',
  attachments jsonb /* @use Json */ not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, user_id, session_id) references ai_chat_sessions (tenant_id, user_id, id) on delete cascade
);

/* init_order = 3 */

/** The chat sessions of the landing page demo chat. */
create table landing_chat_sessions (
  tenant_id varchar(21) not null
    references tenants (id) on update cascade on delete cascade,
  id varchar(21) not null,
  session_id varchar(64) not null,
  messages jsonb /* @use JsonObject */ not null,
  lead jsonb /* @use JsonObject */,
  submitted boolean not null default false,
  created_at timestamptz not null default(now()),
  updated_at timestamptz not null default(now()),
  primary key (id),
  constraint landing_chat_sessions__tenant_id_session_id_unique unique (tenant_id, session_id)
);

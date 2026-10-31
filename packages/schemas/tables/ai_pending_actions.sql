/* init_order = 3 */

/** Writes proposed by Ask AI, executed only after the user confirms the stored action. */
create table ai_pending_actions (
  id varchar(21) not null,
  tenant_id varchar(21) not null
    references tenants (id) on update cascade on delete cascade,
  user_id varchar(21) not null,
  tool text not null,
  arguments jsonb /* @use JsonObject */ not null,
  arguments_hash text not null,
  state text not null default 'pending',
  result jsonb /* @use Json */,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (id),
  constraint ai_pending_actions_state_check check (
    state in ('pending', 'confirmed', 'executed', 'cancelled', 'expired')
  )
);

create index ai_pending_actions__tenant_id on ai_pending_actions (tenant_id);

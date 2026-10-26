/* init_order = 3 */

/** The leads captured by the landing page demo chat. */
create table landing_leads (
  tenant_id varchar(21) not null
    references tenants (id) on update cascade on delete cascade,
  id varchar(21) not null,
  session_id varchar(64) not null,
  lead jsonb /* @use JsonObject */ not null,
  company_profile jsonb /* @use JsonObject */,
  email_status varchar(16) not null default 'pending',
  status varchar(16) not null default 'new',
  notes text not null default '',
  tags text[] not null default '{}',
  created_at timestamptz not null default(now()),
  updated_at timestamptz not null default(now()),
  primary key (id),
  constraint landing_leads__tenant_id_session_id_unique unique (tenant_id, session_id)
);

/* init_order = 3 */

/** The landing page of the marketing site. One draft and one published document per tenant. */
create table landing_pages (
  tenant_id varchar(21) not null
    references tenants (id) on update cascade on delete cascade,
  id varchar(21) not null,
  draft jsonb /* @use JsonObject */ not null,
  published jsonb /* @use JsonObject */,
  published_version integer,
  created_at timestamptz not null default(now()),
  updated_at timestamptz not null default(now()),
  primary key (id),
  constraint landing_pages__tenant_id_unique unique (tenant_id)
);

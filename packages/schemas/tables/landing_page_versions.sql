/* init_order = 3 */

/** The immutable history of the published landing page documents, for rollback. */
create table landing_page_versions (
  tenant_id varchar(21) not null
    references tenants (id) on update cascade on delete cascade,
  id varchar(21) not null,
  version integer not null,
  document jsonb /* @use JsonObject */ not null,
  published_by varchar(21) not null,
  created_at timestamptz not null default(now()),
  primary key (id),
  constraint landing_page_versions__tenant_id_version_unique unique (tenant_id, version)
);

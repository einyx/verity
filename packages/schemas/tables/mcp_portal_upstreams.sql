/* init_order = 3 */

/** The tenant-scoped upstreams behind an MCP portal. */
create table mcp_portal_upstreams (
  tenant_id varchar(21) not null
    references tenants (id) on update cascade on delete cascade,
  portal_id text not null,
  name text not null,
  url text not null,
  credential_ciphertext text,
  created_at timestamptz not null default now(),
  enabled boolean not null default true,
  disabled_tools text[] not null default '{}',
  organization_ids text[] not null default '{}',
  primary key (portal_id, name),
  constraint mcp_portal_upstreams_name_format check (name ~ '^[a-z][a-z0-9-]{0,31}$')
);

create index mcp_portal_upstreams__tenant_id on mcp_portal_upstreams (tenant_id);

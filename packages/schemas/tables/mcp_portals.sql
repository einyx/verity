/* init_order = 3 */

/** The tenant-scoped MCP portals served by this instance. */
create table mcp_portals (
  tenant_id varchar(21) not null
    references tenants (id) on update cascade on delete cascade,
  id uuid primary key,
  name text not null,
  hostname text not null unique,
  created_at timestamptz not null default now(),
  organization_ids text[] not null default '{}'
);

create index mcp_portals__tenant_id on mcp_portals (tenant_id);

/* init_order = 3 */
/* no_after_each */

/** The MCP portals served by this instance. Not tenant-scoped: a portal is reachable from any host. */
create table mcp_portals (
  id uuid primary key,
  name text not null,
  hostname text not null unique,
  created_at timestamptz not null default now(),
  organization_ids text[] not null default '{}'
);

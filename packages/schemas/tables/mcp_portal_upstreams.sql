/* init_order = 3 */
/* no_after_each */

/** The upstreams behind an MCP portal. Not tenant-scoped: a portal is reachable from any host. */
create table mcp_portal_upstreams (
  portal_id text not null,
  name text not null,
  url text not null,
  created_at timestamptz not null default now(),
  enabled boolean not null default true,
  disabled_tools text[] not null default '{}',
  organization_ids text[] not null default '{}',
  primary key (portal_id, name),
  constraint mcp_portal_upstreams_name_format check (name ~ '^[a-z][a-z0-9-]{0,31}$')
);

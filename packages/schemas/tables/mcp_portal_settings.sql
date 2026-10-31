/* init_order = 3 */

/** The tenant's MCP portal hostname settings. */
create table mcp_portal_settings (
  tenant_id varchar(21) not null
    references tenants (id) on update cascade on delete cascade,
  id varchar(32) not null default 'default',
  base_domain text,
  primary key (tenant_id, id)
);

create index mcp_portal_settings__tenant_id on mcp_portal_settings (tenant_id);

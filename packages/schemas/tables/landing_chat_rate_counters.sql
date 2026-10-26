/* init_order = 3 */

/** The rate counters of the landing page demo chat, per key and window. */
create table landing_chat_rate_counters (
  tenant_id varchar(21) not null
    references tenants (id) on update cascade on delete cascade,
  counter_key varchar(128) not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (tenant_id, counter_key)
);

import { sql } from '@silverhand/slonik';

/**
 * Console SSO tables in the `meshx_cloud` database, next to the billing tables. A domain belongs to
 * one connection and is removed with it. The challenge token is stored so a retry re-shows the same
 * record; it is not a credential.
 */
export const consoleSsoSchemaSql = sql`
  create table if not exists console_sso_connectors (
    id varchar(64) not null,
    owner_sub varchar(128) not null,
    provider varchar(32) not null,
    display_name text not null,
    client_id text not null,
    created_at timestamptz not null default now(),
    core_connector_id varchar(128),
    primary key (id)
  );

  alter table console_sso_connectors add column if not exists core_connector_id varchar(128);

  create index if not exists console_sso_connectors_owner_idx
    on console_sso_connectors (owner_sub);

  create table if not exists console_sso_domains (
    connector_id varchar(64) not null references console_sso_connectors (id) on delete cascade,
    domain varchar(253) not null,
    token text not null,
    verified_at timestamptz,
    primary key (connector_id, domain)
  );

  -- Same startup rule as the billing tables: every business table has RLS enabled.
  alter table console_sso_connectors enable row level security;
  alter table console_sso_domains enable row level security;
`;

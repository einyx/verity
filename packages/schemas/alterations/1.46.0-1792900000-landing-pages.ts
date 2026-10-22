import { type CommonQueryMethods, sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

// Landing page CMS: one draft and one published document per tenant, plus an immutable history of
// published versions for rollback. The documents are section lists validated by the application
// (see `landingPageDocumentGuard`); the database only stores them as jsonb. Scoped to the tenant
// like the other business tables, so the tenant's own database user only sees its rows.
const pageTable = 'landing_pages';
const versionTable = 'landing_page_versions';

const getDatabaseName = async (pool: CommonQueryMethods) => {
  const { currentDatabase } = await pool.one<{ currentDatabase: string }>(sql`
    select current_database();
  `);

  return currentDatabase.replaceAll('-', '_');
};

const alteration: AlterationScript = {
  up: async (pool) => {
    const database = await getDatabaseName(pool);
    const baseRoleId = sql.identifier([`logto_tenant_${database}`]);
    const pageTableId = sql.identifier([pageTable]);
    const versionTableId = sql.identifier([versionTable]);

    await pool.query(sql`
      create table if not exists ${pageTableId} (
        id varchar(21) primary key,
        tenant_id varchar(21) not null
          references tenants (id) on update cascade on delete cascade,
        draft jsonb not null,
        published jsonb,
        published_version integer,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint ${sql.identifier([`${pageTable}__tenant_id_unique`])} unique (tenant_id)
      );

      create table if not exists ${versionTableId} (
        id varchar(21) primary key,
        tenant_id varchar(21) not null
          references tenants (id) on update cascade on delete cascade,
        version integer not null,
        document jsonb not null,
        published_by varchar(21) not null,
        created_at timestamptz not null default now(),
        constraint ${sql.identifier([`${versionTable}__tenant_id_version_unique`])}
          unique (tenant_id, version)
      );

      create trigger set_tenant_id before insert on ${pageTableId}
        for each row execute procedure set_tenant_id();

      create trigger set_tenant_id before insert on ${versionTableId}
        for each row execute procedure set_tenant_id();

      alter table ${pageTableId} enable row level security;
      alter table ${versionTableId} enable row level security;

      create policy ${sql.identifier([`${pageTable}_tenant_id`])} on ${pageTableId}
        as restrictive
        using (tenant_id = (select id from tenants where db_user = current_user));

      create policy ${sql.identifier([`${versionTable}_tenant_id`])} on ${versionTableId}
        as restrictive
        using (tenant_id = (select id from tenants where db_user = current_user));

      create policy ${sql.identifier([`${pageTable}_modification`])} on ${pageTableId}
        using (true);

      create policy ${sql.identifier([`${versionTable}_modification`])} on ${versionTableId}
        using (true);

      grant select, insert, update, delete on ${pageTableId} to ${baseRoleId};
      grant select, insert, update, delete on ${versionTableId} to ${baseRoleId};
    `);
  },
  down: async (pool) => {
    const pageTableId = sql.identifier([pageTable]);
    const versionTableId = sql.identifier([versionTable]);

    await pool.query(sql`
      drop table if exists ${versionTableId};
      drop table if exists ${pageTableId};
    `);
  },
};

export default alteration;

import { type CommonQueryMethods, sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

// Landing demo chat: one row per visitor conversation in the admin tenant, for the Sales Lead page.
// `messages` holds only the visitor's and the assistant's turns; `lead` holds the lead fields the
// visitor submitted. Docs excerpts and other context are never stored. Scoped to the tenant like the
// other business tables, so the tenant's own database user only sees its rows.
const sessionTable = 'landing_chat_sessions';

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
    const sessionTableId = sql.identifier([sessionTable]);

    await pool.query(sql`
      create table if not exists ${sessionTableId} (
        id varchar(21) primary key,
        tenant_id varchar(21) not null
          references tenants (id) on update cascade on delete cascade,
        session_id varchar(64) not null,
        messages jsonb not null,
        lead jsonb,
        submitted boolean not null default false,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint ${sql.identifier([`${sessionTable}__tenant_id_session_id_unique`])}
          unique (tenant_id, session_id)
      );

      create trigger set_tenant_id before insert on ${sessionTableId}
        for each row execute procedure set_tenant_id();

      alter table ${sessionTableId} enable row level security;

      create policy ${sql.identifier([`${sessionTable}_tenant_id`])} on ${sessionTableId}
        as restrictive
        using (tenant_id = (select id from tenants where db_user = current_user));

      create policy ${sql.identifier([`${sessionTable}_modification`])} on ${sessionTableId}
        using (true);

      grant select, insert, update, delete on ${sessionTableId} to ${baseRoleId};
    `);
  },
  down: async (pool) => {
    const sessionTableId = sql.identifier([sessionTable]);

    await pool.query(sql`
      drop table if exists ${sessionTableId};
    `);
  },
};

export default alteration;

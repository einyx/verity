import { type CommonQueryMethods, sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

// Fixed-window hit counters for the landing demo chat's shared rate limits, one row per counter key
// (for example an IP address or the global daily cap). Each hit upserts the row, so the counts hold
// across every instance of the admin tenant. Rows are small and are overwritten as windows roll over.
const counterTable = 'landing_chat_rate_counters';

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
    const counterTableId = sql.identifier([counterTable]);

    await pool.query(sql`
      create table if not exists ${counterTableId} (
        tenant_id varchar(21) not null
          references tenants (id) on update cascade on delete cascade,
        counter_key varchar(128) not null,
        window_start timestamptz not null,
        hits integer not null default 0,
        primary key (tenant_id, counter_key)
      );

      create trigger set_tenant_id before insert on ${counterTableId}
        for each row execute procedure set_tenant_id();

      alter table ${counterTableId} enable row level security;

      create policy ${sql.identifier([`${counterTable}_tenant_id`])} on ${counterTableId}
        as restrictive
        using (tenant_id = (select id from tenants where db_user = current_user));

      create policy ${sql.identifier([`${counterTable}_modification`])} on ${counterTableId}
        using (true);

      grant select, insert, update, delete on ${counterTableId} to ${baseRoleId};
    `);
  },
  down: async (pool) => {
    const counterTableId = sql.identifier([counterTable]);

    await pool.query(sql`
      drop table if exists ${counterTableId};
    `);
  },
};

export default alteration;

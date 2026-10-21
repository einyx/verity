import { type CommonQueryMethods, sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

// Leads captured by the landing demo chat, one row per conversation in the admin tenant, for the Leads
// page. `lead` holds only the fields the visitor shared; the transcript stays in `landing_chat_sessions`
// and is referenced by `session_id`, never copied. `email_status` records whether the notification email
// was sent, and `status` is reserved for the team's follow-up workflow (v2), defaulting to `new`.
const leadTable = 'landing_leads';

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
    const leadTableId = sql.identifier([leadTable]);

    await pool.query(sql`
      create table if not exists ${leadTableId} (
        id varchar(21) primary key,
        tenant_id varchar(21) not null
          references tenants (id) on update cascade on delete cascade,
        session_id varchar(64) not null,
        lead jsonb not null,
        email_status varchar(16) not null default 'pending',
        status varchar(16) not null default 'new',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint ${sql.identifier([`${leadTable}__tenant_id_session_id_unique`])}
          unique (tenant_id, session_id)
      );

      create trigger set_tenant_id before insert on ${leadTableId}
        for each row execute procedure set_tenant_id();

      alter table ${leadTableId} enable row level security;

      create policy ${sql.identifier([`${leadTable}_tenant_id`])} on ${leadTableId}
        as restrictive
        using (tenant_id = (select id from tenants where db_user = current_user));

      create policy ${sql.identifier([`${leadTable}_modification`])} on ${leadTableId}
        using (true);

      grant select, insert, update, delete on ${leadTableId} to ${baseRoleId};
    `);
  },
  down: async (pool) => {
    const leadTableId = sql.identifier([leadTable]);

    await pool.query(sql`
      drop table if exists ${leadTableId};
    `);
  },
};

export default alteration;

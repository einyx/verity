import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { createInterceptorsPreset, createPool, type DatabasePool, sql } from '@silverhand/slonik';
import { z } from 'zod/v3';

/** Synthetic schema/role lifecycle, restricted to this worker's separately owned loopback port. */
export async function createBrowserDatabase(databaseUrl: string) {
  const url = new URL(databaseUrl);
  if (
    url.hostname !== '127.0.0.1' ||
    url.port !== '52970' ||
    url.pathname !== '/frontend_ai_chat_test' ||
    url.username !== 'postgres' ||
    url.password !== 'local-test-only'
  ) {
    throw new Error('Only the separately owned frontend disposable database is allowed');
  }
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const schema = `frontend_browser_${suffix}`;
  const role = `frontend_browser_${suffix}`;
  const baseRole = 'logto_tenant_frontend_ai_chat_test';
  const bootstrap = await createPool(databaseUrl);
  const baseExisted = await bootstrap.maybeOne(
    sql`select 1 from pg_roles where rolname = ${baseRole}`
  );
  if (!baseExisted) {
    await bootstrap.query(sql`create role ${sql.identifier([baseRole])}`);
  }
  await bootstrap.query(sql`create schema ${sql.identifier([schema])}`);
  await bootstrap.query(sql`create role ${sql.identifier([role])}`);
  await bootstrap.query(sql`grant ${sql.identifier([baseRole])} to ${sql.identifier([role])}`);
  await bootstrap.query(
    sql`grant usage on schema ${sql.identifier([schema])} to ${sql.identifier([role])}`
  );
  const admin = await createPool(databaseUrl, {
    interceptors: [
      {
        afterPoolConnection: async (_, connection) => {
          await connection.query(sql`set search_path to ${sql.identifier([schema])}`);
          return null;
        },
      },
    ],
  });
  await admin.query(sql`create table tenants (id varchar(21) primary key, db_user text unique)`);
  await admin.query(sql`insert into tenants values ('tenant-a', ${role})`);
  await admin.query(sql`grant select on tenants to ${sql.identifier([role])}`);
  await admin.query(
    sql.raw(
      await readFile(new URL('../../../schemas/tables/_functions.sql', import.meta.url), 'utf8')
    )
  );
  await admin.query(
    sql.raw(
      await readFile(
        new URL('../../../schemas/tables/ai_pending_actions.sql', import.meta.url),
        'utf8'
      )
    )
  );
  const policies = await readFile(
    new URL('../../../schemas/tables/_after_each.sql', import.meta.url),
    'utf8'
  );
  await admin.query(sql.raw(policies.replaceAll(['$', '{name}'].join(''), 'ai_pending_actions')));
  await admin.query(
    sql`grant select, insert, update, delete on ai_pending_actions to ${sql.identifier([baseRole])}`
  );
  await admin.query(
    sql`alter table ai_pending_actions drop constraint ai_pending_actions_chat_owner`
  );
  const migrationPath = '../../../schemas/alterations-js/1.46.0-1793620000-ai-chat-sessions.js';
  const migrationGuard = z.object({
    default: z.object({
      up: z.function().args(z.custom<DatabasePool>()).returns(z.promise(z.void())),
    }),
  });
  const migration = migrationGuard.parse(await import(migrationPath));
  await migration.default.up(admin);
  const pool = await createPool(databaseUrl, {
    interceptors: [
      ...createInterceptorsPreset(),
      {
        afterPoolConnection: async (_, connection) => {
          await connection.query(sql`set search_path to ${sql.identifier([schema])}`);
          await connection.query(sql`set role ${sql.identifier([role])}`);
          return null;
        },
      },
    ],
  });
  return {
    pool,
    close: async () => {
      await pool.end();
      await admin.end();
      await bootstrap.query(sql`drop schema ${sql.identifier([schema])} cascade`);
      await bootstrap.query(sql`drop role ${sql.identifier([role])}`);
      if (!baseExisted) {
        await bootstrap.query(sql`drop role ${sql.identifier([baseRole])}`);
      }
      await bootstrap.end();
    },
  };
}

import { sql, type DatabasePool } from '@silverhand/slonik';

/** Never use an implicit or production database for destructive regression fixtures. */
export const validateTenantDeletionTestUrl = (value: string) => {
  const url = new URL(value);
  if (
    url.protocol !== 'postgres:' ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '58126' ||
    url.pathname !== '/verity_tenant_delete_test' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Refusing any database other than the isolated local tenant-deletion fixture.');
  }
  return url;
};

/** Detect a new tenant-owned table that would silently escape deletion cleanup. */
export const nonCascadingTenantTables = async (pool: DatabasePool) => {
  const rows = await pool.any<{ name: string }>(sql`
    select c.relname as name
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attname='tenant_id' and not a.attisdropped
    where n.nspname='public' and c.relkind in ('r','p') and not exists (
      select 1 from pg_constraint f where f.conrelid=c.oid
        and f.confrelid='public.tenants'::regclass and f.contype='f'
        and f.confdeltype='c' and a.attnum=any(f.conkey)
    ) order by c.relname
  `);
  return rows.map(({ name }) => name);
};

export const readTenantTelemetryCounts = async (pool: DatabasePool, tenantId: string) =>
  Promise.all(
    [
      'service_logs',
      'daily_active_users',
      'daily_token_usage',
      'aggregated_daily_active_users',
    ].map(async (table) =>
      pool.oneFirst<number>(sql`
      select count(*)::integer from ${sql.identifier([table])} where tenant_id=${tenantId}`)
    )
  );

/** Test-only failure injection, installed only after the owned database marker is verified. */
export const installDeleteAuditFailureFixture = async (pool: DatabasePool) => {
  await pool.query(sql`
    create table if not exists tenant_delete_fail_audit_targets (id text primary key);
    create or replace function tenant_delete_test_reject_audit() returns trigger language plpgsql as $$
    begin
      if NEW.type='deleteTenant' and exists (
        select 1 from tenant_delete_fail_audit_targets where id=NEW.payload->>'targetTenantId'
      ) then raise exception 'fixture audit unavailable'; end if;
      return NEW;
    end;
    $$;
    create or replace trigger tenant_delete_test_reject_audit
      before insert on service_logs for each row execute function tenant_delete_test_reject_audit();
  `);
};

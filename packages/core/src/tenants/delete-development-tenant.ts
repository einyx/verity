import { createTenantDatabaseMetadata } from '@logto/core-kit';
import {
  adminTenantId,
  defaultTenantId,
  getTenantOrganizationId,
  LogResult,
  TenantScope,
  TenantTag,
} from '@logto/schemas';
import { ConsoleLog, generateStandardId } from '@logto/shared';
import { sql, type DatabasePool } from '@silverhand/slonik';

import RequestError from '#src/errors/RequestError/index.js';
import { readTenantScopes } from '#src/routes/cloud-console-host.js';
import { canManageTenants } from '#src/routes/cloud-tenant-access.js';
import assertThat from '#src/utils/assert-that.js';

const consoleLog = new ConsoleLog('tenant-delete');
const forbidden = () => new RequestError({ code: 'auth.forbidden', status: 403 });
const conflict = (reason: string) =>
  new RequestError({ code: 'request.general', status: 409 }, { reason });

/** Delete only an eligible identity tenant. Never drop databases, schemas or external workloads. */
export const deleteDevelopmentTenant = async (
  pool: DatabasePool,
  { tenantId, actorId }: { tenantId: string; actorId: string }
) => {
  assertThat(tenantId !== adminTenantId && tenantId !== defaultTenantId, forbidden());
  try {
    await pool.transaction(async (connection) => {
      const actor = await connection.maybeOne(sql`
        select id from users where tenant_id = ${adminTenantId} and id = ${actorId}
          and is_suspended = false for share
      `);
      assertThat(actor && (await canManageTenants(connection, actorId)), forbidden());
      // Serialize deletion with conversion and other deletion attempts, then
      // authorize against current target metadata/membership inside this transaction.
      const row = await connection.maybeOne<{ id: string; tag: string; dbUser: string }>(sql`
        select id, tag, coalesce(db_user, '') as "dbUser"
        from tenants where id = ${tenantId} for update
      `);
      assertThat(row, new RequestError({ code: 'entity.not_found', status: 404 }));
      const scopes = await readTenantScopes(connection, tenantId, actorId);
      assertThat(
        scopes.some(({ name }) => name === TenantScope.ManageTenant),
        forbidden()
      );
      // The host does not yet own production billing teardown. Never treat
      // Console plan hints or cached entitlement data as deletion clearance.
      assertThat(row.tag === TenantTag.Development, conflict('billing_clearance_required'));

      const database = await connection.oneFirst<string>(sql`select current_database()`);
      const { role } = createTenantDatabaseMetadata(database.replaceAll('-', '_'), row.id);
      assertThat(
        row.dbUser === role && Buffer.byteLength(role, 'utf8') <= 63,
        conflict('tenant_role_mismatch')
      );
      const privileged = await connection.oneFirst<boolean>(sql`
        select exists(select 1 from pg_roles where rolname = ${role}
          and (rolsuper or rolcreaterole or rolcreatedb or rolreplication or rolbypassrls))
      `);
      assertThat(!privileged, conflict('tenant_role_not_restricted'));

      await connection.query(sql`delete from organizations
        where tenant_id = ${adminTenantId} and id = ${getTenantOrganizationId(row.id)}`);
      // These global telemetry tables deliberately have no FK to tenants.

      for (const table of [
        'service_logs',
        'daily_active_users',
        'daily_token_usage',
        'aggregated_daily_active_users',
      ]) {
        // eslint-disable-next-line no-await-in-loop -- Fixed-order cleanup must finish before role removal and commit.
        await connection.query(
          sql`delete from ${sql.identifier([table])} where tenant_id = ${row.id}`
        );
      }
      await connection.query(sql`delete from tenants where id = ${row.id}`);
      // DROP ROLE is transactional. Do not use DROP OWNED/CASCADE: unexpected
      // ownership or grants must fail and restore every preceding cleanup step.
      await connection.query(sql`drop role if exists ${sql.identifier([role])}`);
      await connection.query(sql`insert into service_logs (id, tenant_id, type, payload)
        values (${generateStandardId()}, ${adminTenantId}, 'deleteTenant',
          ${sql.jsonb({ actorId, targetTenantId: row.id, result: LogResult.Success })})`);
    });
  } catch (error: unknown) {
    if (error instanceof RequestError) {
      throw error;
    }
    consoleLog.warn('Tenant deletion transaction failed', {
      tenantId,
      errorName: error instanceof Error ? error.name : 'Unknown error',
    });
    throw new RequestError(
      { code: 'request.general', status: 503 },
      { reason: 'tenant_deletion_unavailable' }
    );
  }
};

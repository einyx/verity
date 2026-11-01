import { createTenantDatabaseMetadata } from '@logto/core-kit';
import { adminTenantId, defaultTenantId } from '@logto/schemas';
import type { CommonQueryMethods } from '@silverhand/slonik';
import { sql } from '@silverhand/slonik';

import { consoleLog } from '../utils.js';

export const getDatabaseName = async (pool: CommonQueryMethods, normalized = false) => {
  const { currentDatabase } = await pool.one<{ currentDatabase: string }>(sql`
    select current_database();
  `);

  return normalized ? currentDatabase.replaceAll('-', '_') : currentDatabase;
};

/**
 * Check the roles that a fresh Logto database needs before the seed opens its transaction.
 *
 * PostgreSQL roles are shared by the whole cluster, so dropping a database does not remove the
 * roles that were created for it. A role left behind by a seed that failed part way through is
 * harmless: the seed reuses it and sets its password to the stored one.
 *
 * A role that another Logto installation owns is a different matter. Reusing it would change that
 * installation's permissions, so the seed has to stop and let an administrator look at it.
 */
export const assertNoExistingTenantRoles = async (pool: CommonQueryMethods, database: string) => {
  // Derive the names from the same helper `createTenant()` uses at seed time, so this check keeps
  // matching if the naming scheme ever changes.
  const defaultTenant = createTenantDatabaseMetadata(database, defaultTenantId);
  const adminTenant = createTenantDatabaseMetadata(database, adminTenantId);
  const roleNames = [defaultTenant.parentRole, defaultTenant.role, adminTenant.role];

  const existingRoles = await pool.any<{ roleName: string }>(sql`
    select rolname as "roleName"
    from pg_roles
    where rolname in (${sql.join(
      roleNames.map((roleName) => sql`${roleName}`),
      sql`, `
    )})
    order by rolname
  `);

  if (existingRoles.length === 0) {
    return;
  }

  // The role names carry the database name, so they can only have been created for this
  // database. The remaining question is whether another installation already claimed them, which
  // shows up as a tenant row that points at one of these roles.
  // The check runs before the seed creates the tables, so the table may not be there yet.
  const owners = await pool
    .any<{ id: string; dbUser: string }>(sql`
      select id, db_user as "dbUser" from tenants
      where db_user in (${sql.join(
        roleNames.map((roleName) => sql`${roleName}`),
        sql`, `
      )})
    `)
    .catch(() => []);

  if (owners.length > 0) {
    throw new Error(
      [
        `Cannot seed database "${database}" because these PostgreSQL roles are already in use:`,
        ...existingRoles.map(({ roleName }) => `  - ${roleName}`),
        ...owners.map(({ id, dbUser }) => `  - used by tenant "${id}" (${dbUser})`),
        '',
        'Reusing them would change the permissions of that installation.',
        'Remove them as a PostgreSQL administrator, or point this deployment at a different database, and run the seed command again.',
      ].join('\n')
    );
  }

  consoleLog.info(
    `Reusing the PostgreSQL roles left behind by an earlier seed of "${database}": ${existingRoles
      .map(({ roleName }) => roleName)
      .join(', ')}`
  );
};

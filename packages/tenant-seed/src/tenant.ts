import { createTenantDatabaseMetadata } from '@logto/core-kit';
import {
  type AdminData,
  type UpdateAdminData,
  type CreateScope,
  type CreateRolesScope,
  Roles,
  PredefinedScope,
  getManagementApiResourceIndicator,
} from '@logto/schemas';
import { generateStandardId } from '@logto/shared';
import { assert } from '@silverhand/essentials';
import type { CommonQueryMethods, DatabaseTransactionConnection } from '@silverhand/slonik';
import { sql } from '@silverhand/slonik';

import { getDatabaseName } from './database-name.js';
import { insertInto } from './insert-into.js';

export type TenantMetadata = {
  name?: string;
  tag?: string;
  regionName?: string;
};

/**
 * Create the tenant row and its database role. Metadata is written only when given: `insertInto`
 * writes `null` for missing keys, and `name` cannot be null.
 */
export const createTenant = async (
  pool: CommonQueryMethods,
  tenantId: string,
  metadata: TenantMetadata = {}
) => {
  const database = await getDatabaseName(pool, true);
  const { parentRole, role, password } = createTenantDatabaseMetadata(database, tenantId);
  const createTenant = {
    id: tenantId,
    dbUser: role,
    dbUserPassword: password,
    ...(metadata.name === undefined ? {} : { name: metadata.name }),
    ...(metadata.tag === undefined ? {} : { tag: metadata.tag }),
    ...(metadata.regionName === undefined ? {} : { regionName: metadata.regionName }),
  };

  await pool.query(insertInto(createTenant, 'tenants'));

  // PostgreSQL roles are cluster-wide and outlive the database they were created for, so a
  // role may already exist. Create it when it does not, and set its password either way: the
  // stored password is what the runtime connects with, so a role left over from an earlier
  // seed has to match it.
  await pool.query(sql`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = ${role}) then
        create role ${sql.identifier([role])} with inherit login
          password '${sql.raw(password)}'
          in role ${sql.identifier([parentRole])};
      end if;
    end
    $$;
  `);

  await pool.query(sql`
    alter role ${sql.identifier([role])} with login password '${sql.raw(password)}';
  `);
};

export const seedAdminData = async (
  pool: CommonQueryMethods,
  data: AdminData | UpdateAdminData,
  ...additionalScopes: CreateScope[]
) => {
  const { resource, scopes, role } = data;

  assert(
    scopes.every(
      (scope) => resource.tenantId === scope.tenantId && scope.tenantId === role.tenantId
    ),
    new Error('All data should have the same tenant ID')
  );

  const processRole = async () => {
    if ('id' in role) {
      await pool.query(insertInto(role, 'roles'));

      return role.id;
    }

    // Query by role name for existing roles
    const { id } = await pool.one<{ id: string }>(sql`
      select id from roles
      where name=${role.name}
      and tenant_id=${String(role.tenantId)}
    `);

    return id;
  };

  await pool.query(insertInto(resource, 'resources'));
  await Promise.all(
    [...scopes, ...additionalScopes].map(async (scope) => pool.query(insertInto(scope, 'scopes')))
  );

  const roleId = await processRole();
  await Promise.all(
    scopes.map(async ({ id }) =>
      pool.query(
        insertInto(
          {
            id: generateStandardId(),
            roleId,
            scopeId: id,
            tenantId: resource.tenantId,
          } satisfies CreateRolesScope,
          'roles_scopes'
        )
      )
    )
  );
};

export const assignScopesToRole = async (
  pool: CommonQueryMethods,
  tenantId: string,
  roleId: string,
  ...scopeIds: string[]
) => {
  await Promise.all(
    scopeIds.map(async (scopeId) =>
      pool.query(
        insertInto(
          {
            id: generateStandardId(),
            roleId,
            scopeId,
            tenantId,
          } satisfies CreateRolesScope,
          'roles_scopes'
        )
      )
    )
  );
};

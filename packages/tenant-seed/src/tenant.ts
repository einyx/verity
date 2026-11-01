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
  await pool.query(sql`
    create role ${sql.identifier([role])} with inherit login
      password '${sql.raw(password)}'
      in role ${sql.identifier([parentRole])};
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

  // A deployment serves every tenant from one host, so several tenants can ask for a
  // Management API with the same indicator. The indicator is unique per tenant, so the
  // second request reuses the row the first one created instead of inserting a duplicate.
  const existingResource = await pool.maybeOne<{ id: string }>(sql`
    select id from resources
    where indicator = ${resource.indicator} and tenant_id = ${String(resource.tenantId)}
  `);

  const resourceId = existingResource?.id ?? resource.id;

  if (existingResource) {
    await pool.query(
      sql`
        update resources
        set name = ${resource.name}
        where id = ${resourceId}
      `
    );
  } else {
    await pool.query(insertInto(resource, 'resources'));
  }

  // The scope name is unique per tenant and resource, so a scope that already exists on the
  // reused resource is adopted rather than inserted again.
  const allScopes: CreateScope[] = [...scopes, ...additionalScopes];
  const scopeIds: string[] = await Promise.all(
    allScopes.map(async (scope) => {
      const existingScope = await pool.maybeOne<{ id: string }>(sql`
        select id from scopes
        where name = ${scope.name}
          and resource_id = ${resourceId}
          and tenant_id = ${String(scope.tenantId)}
      `);

      if (existingScope) {
        return existingScope.id;
      }

      const scopeId = generateStandardId();
      await pool.query(insertInto({ ...scope, id: scopeId, resourceId }, 'scopes'));

      return scopeId;
    })
  );

  const roleId = await processRole();
  await Promise.all(
    scopeIds.map(async (scopeId) => {
      // The binding is unique per role and scope, and a reused resource can make the
      // same binding appear twice.
      const existing = await pool.maybeOne<{ id: string }>(sql`
        select id from roles_scopes
        where tenant_id = ${String(resource.tenantId)}
          and role_id = ${roleId}
          and scope_id = ${scopeId}
      `);

      if (existing) {
        return;
      }

      await pool.query(
        insertInto(
          {
            id: generateStandardId(),
            roleId,
            scopeId,
            tenantId: resource.tenantId,
          } satisfies CreateRolesScope,
          'roles_scopes'
        )
      );
    })
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

import { TenantScope } from '@logto/schemas';
import { sql, type DatabasePool } from '@silverhand/slonik';

// Never use DATABASE_URL or an implicit default. Only the controller-authorized fixture qualifies.
export const validateTenantSettingsTestUrl = (value: string) => {
  const url = new URL(value);
  if (
    url.protocol !== 'postgres:' ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '58125' ||
    url.pathname !== '/verity_tenant_api_test'
  ) {
    throw new Error('Refusing a database other than the authorized tenant API test target.');
  }
  return url;
};

export const createSettingsFixtures = async (pool: DatabasePool) => {
  await pool.query(sql`create table tenants (id text primary key, name text not null, tag text not null,
    region_name text, created_at timestamptz not null default now());
    create table users (tenant_id text, id text, primary_email text, is_suspended boolean default false);
    create table roles (tenant_id text, id text, name text);
    create table users_roles (tenant_id text, user_id text, role_id text);
    create table logto_configs (tenant_id text, key text, value jsonb);
    create table organizations (tenant_id text, id text, is_mfa_required boolean not null default false);
    create table organization_user_relations (tenant_id text, organization_id text, user_id text);
    create table organization_role_user_relations
      (tenant_id text, organization_id text, user_id text, organization_role_id text);
    create table organization_role_scope_relations
      (tenant_id text, organization_role_id text, organization_scope_id text);
    create table organization_scopes (tenant_id text, id text, name text);`);
};

export const resetSettingsFixtures = async (pool: DatabasePool) => {
  await pool.query(sql`truncate tenants, users, roles, users_roles, logto_configs, organizations,
    organization_user_relations, organization_role_user_relations,
    organization_role_scope_relations, organization_scopes;
    insert into tenants (id, name, tag) values
      ('target', 'Target', 'development'), ('other', 'Other', 'production'), ('admin', 'Admin', 'production');
    insert into users (tenant_id, id, primary_email, is_suspended) values
      ('admin', 'manager', 'manager@meshx.io', false), ('admin', 'viewer', 'viewer@meshx.io', false),
      ('admin', 'collaborator', 'collaborator@meshx.io', false),
      ('admin', 'outsider', 'outsider@meshx.io', false), ('admin', 'cross', 'cross@meshx.io', false),
      ('admin', 'operator', 'operator@elsewhere.test', false),
      ('admin', 'suspended', 'suspended@meshx.io', true), ('other', 'foreign', 'foreign@meshx.io', false),
      ('admin', 'denied-domain', 'manager@elsewhere.test', false);
    insert into roles values ('admin', 'operator-role', 'admin');
    insert into users_roles values ('admin', 'operator', 'operator-role');
    insert into organizations values ('admin', 't-target', false), ('admin', 't-other', true),
      ('other', 't-target', true), ('admin', 't-admin', false);
    insert into organization_user_relations values
      ('admin', 't-target', 'manager'), ('admin', 't-target', 'viewer'),
      ('admin', 't-target', 'collaborator'), ('admin', 't-other', 'cross'),
      ('admin', 't-target', 'suspended'), ('admin', 't-target', 'denied-domain');
    insert into organization_role_user_relations values
      ('admin', 't-target', 'manager', 'manage'), ('admin', 't-target', 'viewer', 'read'),
      ('admin', 't-target', 'collaborator', 'read'), ('admin', 't-other', 'cross', 'manage'),
      ('admin', 't-target', 'suspended', 'manage'), ('admin', 't-target', 'denied-domain', 'manage');`);
  await pool.query(sql`insert into organization_scopes values
    ('admin', 'manage', ${TenantScope.ManageTenant}), ('admin', 'read', ${TenantScope.ReadData})`);
  await pool.query(sql`insert into organization_role_scope_relations values
    ('admin', 'manage', 'manage'), ('admin', 'manage', 'read'), ('admin', 'read', 'read');`);
};

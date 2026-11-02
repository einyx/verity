/* eslint-disable @silverhand/fp/no-let, @silverhand/fp/no-mutation -- Jest owns an explicitly isolated local database and deterministic race switch. */
/* eslint-disable unicorn/no-await-expression-member -- Keep HTTP assertions next to the request. */
/* eslint max-lines: [error, 480] -- Keep the real-PG isolation, authorization and rollback cases in one owned fixture. */
import { seedByPool } from '@logto/cli/lib/commands/database/seed/index.js';
import {
  adminTenantId,
  CloudScope,
  defaultTenantId,
  getTenantOrganizationId,
  getTenantRole,
  TenantRole,
  TenantTag,
} from '@logto/schemas';
import { generateStandardId } from '@logto/shared';
import { createMockUtils } from '@logto/shared/esm';
import { createInterceptorsPreset, createPool, sql, type DatabasePool } from '@silverhand/slonik';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import Koa from 'koa';
import request from 'supertest';

import { type EnvSet } from '#src/env-set/index.js';

import {
  installDeleteAuditFailureFixture,
  nonCascadingTenantTables,
  readTenantChatCounts,
  readTenantTelemetryCounts,
  seedTenantChat,
  validateTenantDeletionTestUrl,
} from './cloud-tenant-deletion.test-utils.js';

const { jest } = import.meta;
const { mockEsm } = createMockUtils(jest);
jest.setTimeout(120_000);
const testUrl = process.env.TENANT_DELETION_TEST_DATABASE_URL;
let pool: DatabasePool;
let rolePool: DatabasePool | undefined;
let targetId: string;
let otherId: string;
let releaseConversion: (() => void) | undefined;

mockEsm('#src/env-set/index.js', () => ({
  EnvSet: {
    values: {
      isProduction: true,
      isIntegrationTest: false,
      cloudUrlSet: { endpoint: new URL('https://admin.example.com') },
    },
    get sharedPool() {
      return Promise.resolve(pool);
    },
  },
  getTenantEndpoint: (id: string) => new URL(`https://${id}.example.com`),
}));

const { cloudTenantRoutes } = await import('./cloud-tenants.js');
const { provisionTenant } = await import('#src/tenants/provision.js');
const { tenantExists } = await import('#src/tenants/utils.js');
const keys = await generateKeyPair('RS256');
const jwk = await exportJWK(keys.publicKey);
const issuer = 'https://admin.example.com/oidc';
const audience = 'https://admin.example.com/api';
const token = async (sub = 'manager', claims: Record<string, unknown> = {}) =>
  new SignJWT({
    client_id: 'console',
    scope: CloudScope.ManageTenantSelf,
    sub,
    iss: issuer,
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 300,
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256' })
    .sign(keys.privateKey);

const createApp = () => {
  const app = new Koa();
  app.use(async (ctx, next) => {
    try {
      await next();
    } catch (error: unknown) {
      const failure = error as { status?: number; code?: string; data?: unknown };
      ctx.status = failure.status ?? 500;
      ctx.body = { code: failure.code, data: failure.data };
    }
  });
  app.use(
    cloudTenantRoutes({
      tenantId: adminTenantId,
      oidc: { publicJwks: [jwk], issuer },
    } as unknown as EnvSet).routes()
  );
  app.use((ctx) => {
    ctx.status = 404;
    ctx.body = { downstream: true };
  });
  return app.callback();
};

const roleFor = async (id: string) =>
  pool.oneFirst<string>(sql`select db_user from tenants where id = ${id}`);
const hasTenant = async (id: string) =>
  pool.oneFirst<boolean>(sql`select exists(select 1 from tenants where id = ${id})`);
const hasRole = async (name: string) =>
  pool.oneFirst<boolean>(sql`select exists(select 1 from pg_roles where rolname = ${name})`);
const addMember = async (tenantId: string, userId: string, role: TenantRole) => {
  const organizationId = getTenantOrganizationId(tenantId);
  await pool.query(sql`insert into organization_user_relations (tenant_id, organization_id, user_id)
    values (${adminTenantId}, ${organizationId}, ${userId})`);
  await pool.query(sql`insert into organization_role_user_relations (tenant_id, organization_id, user_id, organization_role_id)
    values (${adminTenantId}, ${organizationId}, ${userId}, ${getTenantRole(role).id})`);
};

describe('tenant deletion fixture boundary', () => {
  it.each([
    'postgres://localhost:58126/verity_tenant_delete_test',
    'postgres://127.0.0.1:5432/verity_tenant_delete_test',
    'postgres://127.0.0.1:58126/logto',
    'postgres://127.0.0.1:58126/verity_tenant_delete_test?options=unsafe',
  ])('rejects a different target: %s', (value) => {
    expect(() => validateTenantDeletionTestUrl(value)).toThrow();
  });
});

(testUrl ? describe : describe.skip)('development tenant deletion with real PostgreSQL', () => {
  const app = createApp();
  beforeAll(async () => {
    if (!testUrl) {
      throw new Error('Explicit TENANT_DELETION_TEST_DATABASE_URL is required.');
    }
    const url = validateTenantDeletionTestUrl(testUrl);
    pool = await createPool(url.href, {
      interceptors: [
        ...createInterceptorsPreset(),
        {
          beforeQueryExecution: async (_context, query) => {
            if (
              releaseConversion &&
              query.sql.includes('for update') &&
              query.sql.includes('from tenants')
            ) {
              const release = releaseConversion;
              releaseConversion = undefined;
              release();
            }
            return null;
          },
        },
      ],
    });
    const initialized = await pool.oneFirst<boolean>(sql`
      select to_regclass('public.tenant_delete_test_ownership') is not null`);
    if (!initialized) {
      expect(
        await pool.oneFirst<number>(sql`
        select count(*)::integer from information_schema.tables where table_schema = 'public'`)
      ).toBe(0);
      await seedByPool(pool, { cloud: true, disablePwnedPasswordCheck: true });
      await pool.query(sql`create table tenant_delete_test_ownership (id text primary key);
        insert into tenant_delete_test_ownership values ('verity-tenant-deletion-tests-v1')`);
    }
    expect(await pool.oneFirst(sql`select id from tenant_delete_test_ownership`)).toBe(
      'verity-tenant-deletion-tests-v1'
    );
    await installDeleteAuditFailureFixture(pool);
    expect(await nonCascadingTenantTables(pool)).toEqual([
      'aggregated_daily_active_users',
      'daily_active_users',
      'daily_token_usage',
      'service_logs',
    ]);
    await pool.query(sql`insert into users (tenant_id, id, primary_email, is_suspended) values
      ('admin','operator','operator@elsewhere.test',false),
      ('admin','manager','manager@meshx.io',false), ('admin','viewer','viewer@meshx.io',false),
      ('admin','cross','cross@meshx.io',false), ('admin','outsider','outsider@meshx.io',false),
      ('admin','suspended','suspended@meshx.io',true), ('admin','denied','denied@elsewhere.test',false)
      on conflict (id) do nothing`);
    await pool.query(sql`insert into users_roles (tenant_id, id, user_id, role_id)
      select 'admin',${generateStandardId()},'operator',id from roles where tenant_id='admin' and name='admin'
      on conflict do nothing`);
  });
  afterAll(async () => {
    await pool.end();
  });
  afterEach(async () => {
    await rolePool?.end();
    rolePool = undefined;
  });
  beforeEach(async () => {
    releaseConversion = undefined;
    targetId = await provisionTenant({
      name: 'Delete target',
      tag: TenantTag.Development,
      creatorId: 'manager',
    });
    otherId = await provisionTenant({
      name: 'Unrelated tenant',
      tag: TenantTag.Development,
      creatorId: 'cross',
    });
    await addMember(targetId, 'viewer', TenantRole.Collaborator);
    await addMember(targetId, 'suspended', TenantRole.Admin);
    await addMember(targetId, 'denied', TenantRole.Admin);
    await pool.query(sql`insert into users (tenant_id,id,username) values
      (${targetId},${`${targetId}-user`},'target-user'), (${otherId},${`${otherId}-user`},'other-user')`);
    await pool.query(sql`insert into service_logs (id,tenant_id,type,payload) values
      (${generateStandardId()},${targetId},'test',${sql.jsonb({ test: true })})`);
    await pool.query(sql`insert into daily_active_users (id,tenant_id,user_id) values
      (${generateStandardId()},${targetId},${`${targetId}-user`})`);
    await pool.query(
      sql`insert into daily_token_usage (id,tenant_id,date) values (${generateStandardId()},${targetId},now())`
    );
    await pool.query(sql`insert into aggregated_daily_active_users (tenant_id,activity_date,user_id,activity_count)
      values (${targetId},current_date,${`${targetId}-user`},1)`);
  });

  it('deletes only the target identity tenant, its console membership and restricted role', async () => {
    await seedTenantChat(pool, targetId);
    await seedTenantChat(pool, otherId);
    const role = await roleFor(targetId);
    const otherRole = await roleFor(otherId);
    const roleUrl = validateTenantDeletionTestUrl(testUrl ?? '');
    roleUrl.username = role;
    roleUrl.password = await pool.oneFirst<string>(
      sql`select db_user_password from tenants where id=${targetId}`
    );
    rolePool = await createPool(roleUrl.href, { interceptors: createInterceptorsPreset() });
    expect(await rolePool.oneFirst(sql`select count(*)::integer from users`)).toBe(1);
    expect(
      await pool.oneFirst<number>(
        sql`select count(*)::integer from logto_configs where tenant_id=${targetId}`
      )
    ).toBeGreaterThan(0);
    const response = await request(app)
      .delete(`/api/tenants/${targetId}`)
      .auth(await token(), { type: 'bearer' });
    expect(response.status).toBe(204);
    expect(await hasTenant(targetId)).toBe(false);
    expect(await tenantExists(targetId)).toBe(false);
    expect(await tenantExists(otherId)).toBe(true);
    expect(await hasRole(role)).toBe(false);
    expect(
      await pool.oneFirst(sql`select count(*)::integer from users where tenant_id=${targetId}`)
    ).toBe(0);
    expect(
      await pool.oneFirst(
        sql`select count(*)::integer from logto_configs where tenant_id=${targetId}`
      )
    ).toBe(0);
    expect(
      await pool.oneFirst(
        sql`select count(*)::integer from organizations where tenant_id='admin' and id=${getTenantOrganizationId(targetId)}`
      )
    ).toBe(0);
    expect(
      await pool.oneFirst(
        sql`select count(*)::integer from organization_user_relations where tenant_id='admin' and organization_id=${getTenantOrganizationId(targetId)}`
      )
    ).toBe(0);
    expect(await readTenantTelemetryCounts(pool, targetId)).toEqual([0, 0, 0, 0]);
    expect(await readTenantChatCounts(pool, targetId)).toBe(0);
    expect(await readTenantChatCounts(pool, otherId)).toBe(2);
    expect(await hasTenant(otherId)).toBe(true);
    expect(await hasRole(otherRole)).toBe(true);
    expect(
      await pool.oneFirst(sql`select count(*)::integer from users where tenant_id=${otherId}`)
    ).toBe(1);
    expect(await hasTenant(adminTenantId)).toBe(true);
    expect(await hasTenant(defaultTenantId)).toBe(true);
    expect(
      await pool.oneFirst(sql`select count(*)::integer from service_logs where tenant_id='admin'
      and type='deleteTenant' and payload->>'targetTenantId'=${targetId} and payload->>'actorId'='manager'`)
    ).toBe(1);
    expect(
      (
        await request(app)
          .get(`/api/tenants/${targetId}`)
          .auth(await token(), { type: 'bearer' })
      ).status
    ).toBe(404);
  });

  it.each(['viewer', 'cross', 'outsider', 'suspended', 'denied', 'missing', 'console'])(
    'denies actor %s without modifying the tenant',
    async (actor) => {
      const role = await roleFor(targetId);
      expect(
        (
          await request(app)
            .delete(`/api/tenants/${targetId}`)
            .auth(await token(actor), { type: 'bearer' })
        ).status
      ).toBe(403);
      expect(await hasTenant(targetId)).toBe(true);
      expect(await hasRole(role)).toBe(true);
    }
  );

  it.each([
    { iss: 'https://wrong.example/oidc' },
    { aud: 'https://wrong.example/api' },
    { exp: 1 },
    { scope: '' },
  ])('denies invalid claims: %j', async (claims) => {
    const response = await request(app)
      .delete(`/api/tenants/${targetId}`)
      .auth(await token('manager', claims), { type: 'bearer' });
    expect([401, 403]).toContain(response.status);
    expect(await hasTenant(targetId)).toBe(true);
  });

  it.each([adminTenantId, defaultTenantId])(
    'protects %s even from the instance operator',
    async (id) => {
      const role = await roleFor(id);
      expect(
        (
          await request(app)
            .delete(`/api/tenants/${id}`)
            .auth(await token('operator'), { type: 'bearer' })
        ).status
      ).toBe(403);
      expect(await hasTenant(id)).toBe(true);
      expect(await hasRole(role)).toBe(true);
    }
  );

  it('returns404 for a nonexistent target without falling through to billing', async () => {
    const response = await request(app)
      .delete('/api/tenants/nonexistent')
      .auth(await token(), { type: 'bearer' });
    expect(response.status).toBe(404);
    expect(response.body).not.toHaveProperty('downstream');
  });

  it.each(['production', 'future-tag'])(
    'fails closed for tag %s and unsafe role metadata',
    async (tag) => {
      await pool.query(sql`update tenants set tag=${tag} where id=${targetId}`);
      expect(
        (
          await request(app)
            .delete(`/api/tenants/${targetId}`)
            .auth(await token(), { type: 'bearer' })
        ).status
      ).toBe(409);
      await pool.query(
        sql`update tenants set tag='development',db_user=${`unsafe_${targetId}`} where id=${targetId}`
      );
      expect(
        (
          await request(app)
            .delete(`/api/tenants/${targetId}`)
            .auth(await token(), { type: 'bearer' })
        ).status
      ).toBe(409);
      expect(await hasTenant(targetId)).toBe(true);
      expect(await hasRole('logto_tenant_verity_tenant_delete_test')).toBe(true);
    }
  );

  it('refuses a tenant role that has been promoted to privileged capabilities', async () => {
    const role = await roleFor(targetId);
    await pool.query(sql`alter role ${sql.identifier([role])} createrole`);
    expect(
      (
        await request(app)
          .delete(`/api/tenants/${targetId}`)
          .auth(await token(), { type: 'bearer' })
      ).status
    ).toBe(409);
    expect(await hasTenant(targetId)).toBe(true);
    expect(await hasRole(role)).toBe(true);
  });

  it('rolls back data, organization cleanup and audit when role removal fails', async () => {
    const role = await roleFor(targetId);
    const dependency = `owned_${targetId}`;
    await pool.query(sql`create table ${sql.identifier([dependency])} (id integer);
      alter table ${sql.identifier([dependency])} owner to ${sql.identifier([role])}`);
    const response = await request(app)
      .delete(`/api/tenants/${targetId}`)
      .auth(await token(), { type: 'bearer' });
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      code: 'request.general',
      data: { reason: 'tenant_deletion_unavailable' },
    });
    expect(JSON.stringify(response.body)).not.toContain(role);
    expect(JSON.stringify(response.body)).not.toMatch(/DROP ROLE|owned_|pg_roles/);
    expect(await hasTenant(targetId)).toBe(true);
    expect(await hasRole(role)).toBe(true);
    expect(await readTenantTelemetryCounts(pool, targetId)).toEqual([1, 1, 1, 1]);
    expect(
      await pool.oneFirst(sql`select count(*)::integer from users where tenant_id=${targetId}`)
    ).toBe(1);
    expect(
      await pool.oneFirst(
        sql`select count(*)::integer from organizations where tenant_id='admin' and id=${getTenantOrganizationId(targetId)}`
      )
    ).toBe(1);
    expect(
      await pool.oneFirst(
        sql`select count(*)::integer from service_logs where tenant_id='admin' and type='deleteTenant' and payload->>'targetTenantId'=${targetId}`
      )
    ).toBe(0);
  });

  it('rolls back the role, tenant, organization and telemetry when audit insertion fails', async () => {
    const role = await roleFor(targetId);
    await pool.query(sql`insert into tenant_delete_fail_audit_targets values (${targetId})`);
    const response = await request(app)
      .delete(`/api/tenants/${targetId}`)
      .auth(await token(), { type: 'bearer' });
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain('fixture audit unavailable');
    expect(await hasTenant(targetId)).toBe(true);
    expect(await hasRole(role)).toBe(true);
    expect(await readTenantTelemetryCounts(pool, targetId)).toEqual([1, 1, 1, 1]);
    expect(
      await pool.oneFirst(sql`select count(*)::integer from organizations
      where tenant_id='admin' and id=${getTenantOrganizationId(targetId)}`)
    ).toBe(1);
  });

  it('revalidates a concurrent production conversion after acquiring the row lock', async () => {
    let conversionReady: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      conversionReady = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseConversion = resolve;
    });
    const conversion = pool.transaction(async (connection) => {
      await connection.query(sql`update tenants set tag='production' where id=${targetId}`);
      conversionReady?.();
      await release;
    });
    await ready;
    try {
      const response = await request(app)
        .delete(`/api/tenants/${targetId}`)
        .auth(await token(), { type: 'bearer' });
      expect(response.status).toBe(409);
    } finally {
      releaseConversion?.();
      await conversion;
    }
    expect(await hasTenant(targetId)).toBe(true);
  });

  it('serializes duplicate deletes without removing another tenant', async () => {
    const bearer = await token();
    const responses = await Promise.all(
      [1, 2].map(async () =>
        request(app).delete(`/api/tenants/${targetId}`).auth(bearer, { type: 'bearer' })
      )
    );
    expect(new Set(responses.map(({ status }) => status))).toEqual(new Set([204, 404]));
    expect(await hasTenant(otherId)).toBe(true);
  });
});

/* eslint-enable @silverhand/fp/no-let, @silverhand/fp/no-mutation */
/* eslint-enable unicorn/no-await-expression-member */

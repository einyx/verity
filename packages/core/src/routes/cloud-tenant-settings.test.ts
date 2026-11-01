/* eslint-disable @silverhand/fp/no-let, @silverhand/fp/no-mutation -- Jest lifecycle owns the isolated pools and deterministic race switch. */
/* eslint max-lines: [error, 500] -- Keep real-PG authorization and overlapping-conversion regressions on one owned fixture. */
/* eslint-disable unicorn/no-await-expression-member -- Keep HTTP status/body assertions next to their request. */
/* eslint-disable no-await-in-loop -- Sequential requests prove persistence and absence of partial writes. */
import { randomUUID } from 'node:crypto';

import { adminTenantId, CloudScope } from '@logto/schemas';
import { createMockUtils } from '@logto/shared/esm';
import { createPool, sql, type DatabasePool } from '@silverhand/slonik';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import Koa from 'koa';
import request from 'supertest';

import { type EnvSet } from '#src/env-set/index.js';

import {
  createSettingsFixtures,
  resetSettingsFixtures,
  validateTenantSettingsTestUrl,
} from './cloud-tenant-settings.test-utils.js';

const { jest } = import.meta;
const { mockEsm } = createMockUtils(jest);
const testUrl = process.env.TENANT_SETTINGS_TEST_DATABASE_URL;
const schema = `tenant_settings_${randomUUID().replaceAll('-', '')}`;
let pool: DatabasePool;
const getSubscriptionData = jest.fn(async () => ({ planId: 'pro', isEnterprisePlan: false }));
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
mockEsm('#src/tenants/tenant-lookup.js', () => ({
  getTenantForUsage: async (id: string) => {
    expect(id).toBe('target');
    return { subscription: { getSubscriptionData } };
  },
}));
const { cloudTenantRoutes } = await import('./cloud-tenants.js');
const keys = await generateKeyPair('RS256');
const jwk = await exportJWK(keys.publicKey);
const issuer = 'https://admin.example.com/oidc';
const audience = 'https://admin.example.com/api';
const token = async (sub = 'manager', claims: Record<string, unknown> = {}) =>
  new SignJWT({ client_id: 'console', scope: CloudScope.ManageTenantSelf, ...claims })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject(sub)
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime('5m')
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

(testUrl ? describe : describe.skip)('cloud tenant settings with real isolated PostgreSQL', () => {
  let setupPool: DatabasePool | undefined;
  let convertBeforeProfileUpdate = false;
  let finishConversion: (() => void) | undefined;
  const app = createApp();
  beforeAll(async () => {
    if (!testUrl) {
      throw new Error('Explicit TENANT_SETTINGS_TEST_DATABASE_URL is required.');
    }
    const url = validateTenantSettingsTestUrl(testUrl);
    setupPool = await createPool(url.href);
    await setupPool.query(sql`create schema ${sql.identifier([schema])}`);
    // Slonik does not forward URL `options` to pg; explicitly scope every checked-out connection.
    pool = await createPool(url.href, {
      interceptors: [
        {
          afterPoolConnection: async (_context, connection) => {
            await connection.query(sql`select set_config('search_path', ${schema}, false)`);
            return null;
          },
          beforeQueryExecution: async (_context, query) => {
            if (
              finishConversion &&
              (query.sql.includes('for update') || query.sql.includes('update organizations'))
            ) {
              finishConversion();
              finishConversion = undefined;
            }
            if (convertBeforeProfileUpdate && query.sql.includes('update tenants set name')) {
              convertBeforeProfileUpdate = false;
              await setupPool?.query(sql`update ${sql.identifier([schema, 'tenants'])}
              set tag = 'production' where id = 'target'`);
            }
            return null;
          },
        },
      ],
    });
    expect(await pool.oneFirst(sql`select current_schema()`)).toBe(schema);
    await createSettingsFixtures(pool);
  });
  afterAll(async () => {
    await pool.end();
    if (setupPool) {
      await setupPool.query(sql`drop schema ${sql.identifier([schema])} cascade`);
      await setupPool.end();
    }
  });
  beforeEach(async () => {
    convertBeforeProfileUpdate = false;
    getSubscriptionData.mockReset().mockResolvedValue({ planId: 'pro', isEnterprisePlan: false });
    await resetSettingsFixtures(pool);
  });

  it.each([
    { enable: true, unavailable: false, status: 403 },
    { enable: true, unavailable: true, status: 503 },
    { enable: false, unavailable: true, status: 200 },
  ])(
    'revalidates an overlapping uncommitted conversion: %j',
    async ({ enable, unavailable, status }) => {
      if (unavailable) {
        getSubscriptionData.mockRejectedValue(new Error('Subscription service unavailable'));
      } else {
        getSubscriptionData.mockResolvedValue({ planId: 'free', isEnterprisePlan: false });
      }
      const bearer = await token();
      let conversionReady: (() => void) | undefined;
      const ready = new Promise<void>((resolve) => {
        conversionReady = resolve;
      });
      const release = new Promise<void>((resolve) => {
        finishConversion = resolve;
      });
      const conversion = pool.transaction(async (connection) => {
        await connection.query(sql`update tenants set tag = 'production' where id = 'target'`);
        conversionReady?.();
        await release;
      });
      await ready;
      try {
        const response = await request(app)
          .patch('/api/tenants/target/settings')
          .auth(bearer, { type: 'bearer' })
          .send({ isMfaRequired: enable });
        expect(response.status).toBe(status);
      } finally {
        finishConversion?.();
        await conversion;
      }
      expect(
        await pool.oneFirst(sql`select is_mfa_required from organizations
      where tenant_id = 'admin' and id = 't-target'`)
      ).toBe(false);
      expect(getSubscriptionData).toHaveBeenCalledTimes(enable ? 1 : 0);
    }
  );

  it('owns successful tenant/profile/settings responses rather than reaching billing', async () => {
    const bearer = await token();
    expect(
      (await request(app).get('/api/tenants/target').auth(bearer, { type: 'bearer' })).status
    ).toBe(200);
    const renamed = await request(app)
      .patch('/api/tenants/target')
      .auth(bearer, { type: 'bearer' })
      .send({ name: 'Renamed', tag: 'development' });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ id: 'target', name: 'Renamed', tag: 'development' });
    expect(
      (await request(app).get('/api/tenants/target/settings').auth(bearer, { type: 'bearer' })).body
    ).toEqual({ isMfaRequired: false });
    const saved = await request(app)
      .patch('/api/tenants/target/settings')
      .auth(bearer, { type: 'bearer' })
      .send({ isMfaRequired: true });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ isMfaRequired: true });
    expect(
      (await request(app).get('/api/tenants/target/settings').auth(bearer, { type: 'bearer' })).body
    ).toEqual({ isMfaRequired: true });
    expect(
      await pool.any(
        sql`select tenant_id, id, is_mfa_required from organizations order by tenant_id, id`
      )
    ).toEqual([
      { tenant_id: 'admin', id: 't-admin', is_mfa_required: false },
      { tenant_id: 'admin', id: 't-other', is_mfa_required: true },
      { tenant_id: 'admin', id: 't-target', is_mfa_required: true },
      { tenant_id: 'other', id: 't-target', is_mfa_required: true },
    ]);
    expect(getSubscriptionData).not.toHaveBeenCalled();
  });
  it.each(['subscription', 'invoices', 'checkout'])('leaves %s to billing', async (path) => {
    expect((await request(app).get(`/api/tenants/target/${path}`)).body).toEqual({
      downstream: true,
    });
  });
  it.each(['manager', 'operator'])('allows %s through target authorization', async (user) => {
    expect(
      (
        await request(app)
          .get('/api/tenants/target/settings')
          .auth(await token(user), { type: 'bearer' })
      ).status
    ).toBe(200);
  });
  it.each([
    'viewer',
    'collaborator',
    'outsider',
    'cross',
    'missing',
    'suspended',
    'foreign',
    'denied-domain',
  ])('denies settings/profile writes for %s', async (user) => {
    const bearer = await token(user);
    for (const path of ['settings', '']) {
      expect(
        (
          await request(app)
            .patch(`/api/tenants/target${path && `/${path}`}`)
            .auth(bearer, { type: 'bearer' })
            .send(path ? { isMfaRequired: true } : { name: 'Forbidden' })
        ).status
      ).toBe(403);
    }
    expect(
      (await request(app).get('/api/tenants/target/settings').auth(bearer, { type: 'bearer' }))
        .status
    ).toBe(403);
    expect(await pool.one(sql`select name from tenants where id = 'target'`)).toEqual({
      name: 'Target',
    });
    expect(
      await pool.one(
        sql`select is_mfa_required from organizations where tenant_id = 'admin' and id = 't-target'`
      )
    ).toEqual({ is_mfa_required: false });
  });
  it('allows ReadData but not settings access to a viewer; conceals admin from nonoperators', async () => {
    expect(
      (
        await request(app)
          .get('/api/tenants/target')
          .auth(await token('viewer'), { type: 'bearer' })
      ).status
    ).toBe(200);
    expect(
      (
        await request(app)
          .get('/api/tenants/admin')
          .auth(await token(), { type: 'bearer' })
      ).status
    ).toBe(404);
    expect(
      (
        await request(app)
          .get('/api/tenants/admin')
          .auth(await token('operator'), { type: 'bearer' })
      ).status
    ).toBe(200);
    expect(
      (
        await request(app)
          .get('/api/tenants/missing/settings')
          .auth(await token('operator'), { type: 'bearer' })
      ).status
    ).toBe(404);
  });
  it.each([
    ['missing bearer', undefined, 401],
    ['missing Cloud scope', { scope: 'read:data' }, 403],
    ['machine token', { client_id: 'manager' }, 403],
    ['wrong audience', { aud: 'https://other.example.com/api' }, 401],
    ['wrong issuer', { iss: 'https://other.example.com/oidc' }, 401],
    ['expired', { exp: 1 }, 401],
  ] as const)('rejects %s', async (_name, claims, status) => {
    // Set claims after defaults so issuer/audience/expiry mutations are signed accurately.
    const bearer =
      claims &&
      (await new SignJWT({
        sub: 'manager',
        client_id: 'console',
        scope: CloudScope.ManageTenantSelf,
        iss: issuer,
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 300,
        ...claims,
      })
        .setProtectedHeader({ alg: 'RS256' })
        .sign(keys.privateKey));
    const response = request(app)
      .patch('/api/tenants/target/settings')
      .send({ isMfaRequired: true });
    expect((await (bearer ? response.auth(bearer, { type: 'bearer' }) : response)).status).toBe(
      status
    );
  });
  it('reads real true/false without writing and returns 404 for missing organization', async () => {
    await pool.query(
      sql`update organizations set is_mfa_required = true where tenant_id = 'admin' and id = 't-target'`
    );
    const before = await pool.any(sql`select * from organizations order by tenant_id, id`);
    expect(
      (
        await request(app)
          .get('/api/tenants/target/settings')
          .auth(await token(), { type: 'bearer' })
      ).body
    ).toEqual({ isMfaRequired: true });
    expect(await pool.any(sql`select * from organizations order by tenant_id, id`)).toEqual(before);
    await pool.query(sql`delete from organizations where tenant_id = 'admin' and id = 't-target'`);
    for (const method of ['get', 'patch'] as const) {
      const call = request(app)
        [method]('/api/tenants/target/settings')
        .auth(await token(), { type: 'bearer' });
      expect((await (method === 'patch' ? call.send({ isMfaRequired: false }) : call)).status).toBe(
        404
      );
    }
  });
  it.each(['development', 'production'])(
    'rejects conversion from %s without a partial rename',
    async (tag) => {
      await pool.query(sql`update tenants set tag = ${tag} where id = 'target'`);
      expect(
        (
          await request(app)
            .patch('/api/tenants/target')
            .auth(await token(), { type: 'bearer' })
            .send({ name: 'Not saved', tag: tag === 'development' ? 'production' : 'development' })
        ).status
      ).toBe(400);
      expect(await pool.one(sql`select name, tag from tenants where id = 'target'`)).toEqual({
        name: 'Target',
        tag,
      });
      expect(getSubscriptionData).not.toHaveBeenCalled();
    }
  );
  it('rejects a real concurrent environment conversion without renaming or overwriting the tag', async () => {
    convertBeforeProfileUpdate = true;
    expect(
      (
        await request(app)
          .patch('/api/tenants/target')
          .auth(await token(), { type: 'bearer' })
          .send({ name: 'Not saved', tag: 'development' })
      ).status
    ).toBe(400);
    expect(await pool.one(sql`select name, tag from tenants where id = 'target'`)).toEqual({
      name: 'Target',
      tag: 'production',
    });
  });
  it('accepts name-only PATCH and the existing all Cloud scope semantics', async () => {
    expect(
      (
        await request(app)
          .patch('/api/tenants/target')
          .auth(await token('manager', { scope: 'all' }), { type: 'bearer' })
          .send({ name: 'Name only' })
      ).body
    ).toMatchObject({ name: 'Name only', tag: 'development' });
  });
  it.each([
    { planId: 'pro', isEnterprisePlan: false },
    { planId: 'pro-202411', isEnterprisePlan: false },
    { planId: 'custom', isEnterprisePlan: true },
  ])('uses authoritative production entitlement %j', async (subscription) => {
    await pool.query(sql`update tenants set tag = 'production' where id = 'target'`);
    getSubscriptionData.mockResolvedValue(subscription);
    expect(
      (
        await request(app)
          .patch('/api/tenants/target/settings')
          .auth(await token(), { type: 'bearer' })
          .send({ isMfaRequired: true })
      ).status
    ).toBe(200);
    expect(getSubscriptionData).toHaveBeenCalledTimes(1);
  });
  it.each(['free', 'development', 'unknown'])(
    'does not mistake synthetic response for entitlement: %s',
    async (planId) => {
      await pool.query(sql`update tenants set tag = 'production' where id = 'target'`);
      getSubscriptionData.mockResolvedValue({ planId, isEnterprisePlan: false });
      expect(
        (
          await request(app)
            .patch('/api/tenants/target/settings')
            .auth(await token(), { type: 'bearer' })
            .send({ isMfaRequired: true })
        ).status
      ).toBe(403);
    }
  );
  it('fails closed on unavailable entitlement but permits explicit authorized disable', async () => {
    await pool.query(sql`update tenants set tag = 'production' where id = 'target'`);
    getSubscriptionData.mockRejectedValue(new Error('Unavailable'));
    expect(
      (
        await request(app)
          .patch('/api/tenants/target/settings')
          .auth(await token(), { type: 'bearer' })
          .send({ isMfaRequired: true })
      ).status
    ).toBe(503);
    expect(
      (
        await request(app)
          .patch('/api/tenants/target/settings')
          .auth(await token(), { type: 'bearer' })
          .send({ isMfaRequired: false })
      ).body
    ).toEqual({ isMfaRequired: false });
    expect(getSubscriptionData).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['', { planId: 'pro' }],
    ['', { isSuspended: false }],
    ['', { quota: {} }],
    ['', { regionName: 'other' }],
    ['settings', { isMfaRequired: 'true' }],
    ['settings', {}],
    ['settings', { isMfaRequired: true, planId: 'pro' }],
  ])('rejects strict body %s %j', async (path, body) => {
    expect(
      (
        await request(app)
          .patch(`/api/tenants/target${path && `/${path}`}`)
          .auth(await token(), { type: 'bearer' })
          .send(body)
      ).status
    ).toBe(400);
  });
});
/* eslint-enable @silverhand/fp/no-let, @silverhand/fp/no-mutation */
/* eslint-enable unicorn/no-await-expression-member */
/* eslint-enable no-await-in-loop */

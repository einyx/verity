/* eslint-disable @silverhand/fp/no-let, @silverhand/fp/no-mutation -- Owned HTTP server lifecycle. */
import { request as rawRequest, type Server } from 'node:http';

import { buildOrganizationUrn } from '@logto/core-kit';
import { getTenantOrganizationId } from '@logto/schemas';
import type { GlobalValues } from '@logto/shared';
import { exportPKCS8, generateKeyPair, SignJWT } from 'jose';
import Koa from 'koa';
import request from 'supertest';

import { getTenantEndpoint } from '#src/env-set/utils.js';

const { jest } = import.meta;
const signing = await generateKeyPair('ES256', { extractable: true });
const privatePem = await exportPKCS8(signing.privateKey);
let listener: Server;
const values = {
  isCloud: true,
  isProduction: true,
  isDomainBasedMultiTenancy: true,
  isPathBasedMultiTenancy: false,
  isMultiTenancy: true,
  urlSet: {
    localhostUrl: new URL('http://localhost:1'),
    endpoint: new URL('https://*.tenant.invalid'),
  },
  adminUrlSet: { endpoint: new URL('https://console.invalid') },
};
const canonicalEndpoint = (id: string) => getTenantEndpoint(id, values as unknown as GlobalValues);
jest.unstable_mockModule('#src/env-set/index.js', () => ({
  EnvSet: {
    values,
    sharedPool: Promise.resolve({
      one: async () => ({ value: [{ id: 'test-key', value: privatePem, createdAt: 0 }] }),
      maybeOne: async (query: { sql: string; values: readonly unknown[] }) =>
        query.sql.includes('organization_role_user_relations')
          ? query.values.includes('member-alpha') && query.values.includes('t-alpha')
            ? { allowed: true }
            : null
          : { id: 'alpha' },
    }),
  },
  getTenantEndpoint: canonicalEndpoint,
  getTenantLocalhost: jest.fn(),
}));
jest.unstable_mockModule('#src/routes/billing.js', () => ({ isBillingConfigured: () => false }));
const { localCloudRoutes } = await import('./cloud-dev.js');
const { default: koaAuth } = await import('#src/middleware/koa-auth/index.js');

beforeAll(async () => {
  const internal = new Koa();
  internal.use(async (ctx) => {
    if (ctx.path === '/api/protected') {
      const tenantId = ctx.get('x-forwarded-host').split('.')[0] ?? '';
      const envSet = {
        tenantId,
        oidc: { publicJwks: [], issuer: `https://${tenantId}.tenant.invalid/oidc` },
      };
      try {
        await koaAuth(envSet as never, buildOrganizationUrn(getTenantOrganizationId(tenantId)))(
          ctx as never,
          async () => {
            ctx.body = { tenantId };
          }
        );
      } catch (error: unknown) {
        ctx.status =
          error instanceof Error && 'status' in error && typeof error.status === 'number'
            ? error.status
            : 500;
      }
      return;
    }
    const chunks: Uint8Array[] = [];
    for await (const chunk of ctx.req) {
      // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- Collect only this owned request stream.
      chunks.push(new Uint8Array(chunk as Uint8Array));
    }
    ctx.body = {
      host: ctx.get('host'),
      forwardedHost: ctx.get('x-forwarded-host'),
      protocol: ctx.get('x-forwarded-proto'),
      forwarded: ctx.get('forwarded'),
      forwardedFor: ctx.get('x-forwarded-for'),
      injectedHop: ctx.get('x-injected-hop'),
      authorization: ctx.get('authorization'),
      url: ctx.url,
      method: ctx.method,
      body: Buffer.concat(chunks).toString(),
    };
  });
  listener = internal.listen(0);
  await new Promise<void>((resolve) => {
    listener.once('listening', resolve);
  });
  const address = listener.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected an owned TCP listener');
  }
  values.urlSet.localhostUrl = new URL(`http://localhost:${address.port}`);
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    listener.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
});

const app = () => {
  const instance = new Koa();
  instance.use(localCloudRoutes());
  return instance.callback();
};

it('uses the configured internal listener without resolving the public tenant edge', async () => {
  const response = await request(app())
    .post('/m/alpha/api/example?keep=a%2Fb')
    .set('authorization', 'Bearer synthetic-test-only')
    .set('x-forwarded-host', 'other.tenant.invalid')
    .set('x-forwarded-proto', 'http')
    .set('forwarded', 'host=attacker.invalid;proto=http')
    .set('x-forwarded-for', 'attacker')
    .set('connection', 'x-injected-hop')
    .set('x-injected-hop', 'untrusted')
    .send('unchanged');

  expect(response.status).toBe(200);
  expect(response.body).toEqual({
    host: 'alpha.tenant.invalid',
    forwardedHost: 'alpha.tenant.invalid',
    protocol: 'https',
    forwarded: '',
    forwardedFor: '',
    injectedHop: '',
    authorization: 'Bearer synthetic-test-only',
    url: '/api/example?keep=a%2Fb',
    method: 'POST',
    body: 'unchanged',
  });
});

it.each(['alpha.evil', 'alpha%2Fevil', 'alpha@evil', 'alpha:99'])(
  'rejects a tenant route that could inject a hostname: %s',
  async (tenantId) => {
    const response = await request(app()).get(`/m/${tenantId}/api/users`);
    expect(response.status).toBe(400);
  }
);

it('does not reuse the preceding tenant identity on a later proxy request', async () => {
  const application = app();
  const alpha = await request(application).get('/m/alpha/api/users');
  const beta = await request(application).get('/m/beta/api/users');
  expect(alpha.body.host).toBe('alpha.tenant.invalid');
  expect(beta.body.host).toBe('beta.tenant.invalid');
});

it('preserves the bare default tenant host in domain mode', async () => {
  const response = await request(app()).get('/m/default/api/users');
  expect(response.body.host).toBe('tenant.invalid');
});

it('preserves tenant path selection in path-based mode', async () => {
  values.isDomainBasedMultiTenancy = false;
  values.isPathBasedMultiTenancy = true;
  values.urlSet.endpoint = new URL('https://tenant.invalid');
  try {
    const response = await request(app()).get('/m/beta/api/users?keep=yes');
    expect(response.status).toBe(200);
    expect(response.body.host).toBe('tenant.invalid');
    expect(response.body.url).toBe('/beta/api/users?keep=yes');
  } finally {
    values.isDomainBasedMultiTenancy = true;
    values.isPathBasedMultiTenancy = false;
    values.urlSet.endpoint = new URL('https://*.tenant.invalid');
  }
});

it('does not alias another tenant onto the default tenant in single-tenant mode', async () => {
  values.isDomainBasedMultiTenancy = false;
  values.urlSet.endpoint = new URL('https://tenant.invalid');
  try {
    const response = await request(app()).get('/m/alpha/api/users');
    expect(response.status).toBe(404);
    const defaultResponse = await request(app()).get('/m/default/api/users');
    expect(defaultResponse.status).toBe(200);
  } finally {
    values.isDomainBasedMultiTenancy = true;
    values.urlSet.endpoint = new URL('https://*.tenant.invalid');
  }
});

it('reports unavailable internal transport with a sanitized error rather than a user 401', async () => {
  const original = values.urlSet.localhostUrl;
  values.urlSet.localhostUrl = new URL('http://localhost:1');
  try {
    const response = await request(app()).get('/m/alpha/api/users?private=synthetic');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ code: 'tenant_transport_unavailable' });
  } finally {
    values.urlSet.localhostUrl = original;
  }
});

it('does not expose tenant OIDC endpoints through the management proxy', async () => {
  const response = await request(app()).get('/m/alpha/oidc/token');
  expect(response.status).toBe(404);
});

it('rejects encoded dot-segment traversal before the internal URL can select another tenant', async () => {
  const outer = new Koa();
  outer.use(localCloudRoutes());
  const server = outer.listen(0);
  await new Promise<void>((resolve) => {
    server.once('listening', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected an owned listener');
  }
  try {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const outgoing = rawRequest(
        {
          port: address.port,
          path: '/m/alpha/api/%2e%2e/%2e%2e/beta/api/users',
        },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        }
      );
      outgoing.on('error', reject);
      outgoing.end();
    });
    expect(status).toBe(400);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});

it('reaches real JWT and tenant membership gates without public-edge access', async () => {
  const token = await new SignJWT({ sub: 'member-alpha' })
    .setProtectedHeader({ alg: 'ES256' })
    .setIssuer('https://console.invalid/oidc')
    .setAudience(buildOrganizationUrn(getTenantOrganizationId('alpha')))
    .setExpirationTime('5m')
    .sign(signing.privateKey);
  const application = app();
  const missing = await request(application).get('/m/alpha/api/protected');
  expect(missing.status).toBe(401);
  const allowed = await request(application)
    .get('/m/alpha/api/protected')
    .auth(token, { type: 'bearer' });
  expect(allowed.status).toBe(200);
  expect(allowed.body).toEqual({ tenantId: 'alpha' });
  const wrongTenant = await request(application)
    .get('/m/beta/api/protected')
    .auth(token, { type: 'bearer' });
  expect(wrongTenant.status).toBe(401);
  const nonmember = await new SignJWT({ sub: 'outsider' })
    .setProtectedHeader({ alg: 'ES256' })
    .setIssuer('https://console.invalid/oidc')
    .setAudience(buildOrganizationUrn(getTenantOrganizationId('alpha')))
    .setExpirationTime('5m')
    .sign(signing.privateKey);
  const forbidden = await request(application)
    .get('/m/alpha/api/protected')
    .auth(nonmember, { type: 'bearer' });
  expect(forbidden.status).toBe(403);
});

it.each(['issuer', 'audience', 'expired'])(
  'rejects a synthetic JWT with invalid %s through the real proxy/auth composition',
  async (invalid) => {
    const token = await new SignJWT({ sub: 'member-alpha' })
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuer(
        invalid === 'issuer' ? 'https://untrusted.invalid/oidc' : 'https://console.invalid/oidc'
      )
      .setAudience(
        invalid === 'audience'
          ? 'untrusted-audience'
          : buildOrganizationUrn(getTenantOrganizationId('alpha'))
      )
      .setExpirationTime(invalid === 'expired' ? '-1m' : '5m')
      .sign(signing.privateKey);
    const response = await request(app())
      .get('/m/alpha/api/protected')
      .auth(token, { type: 'bearer' });
    expect(response.status).toBe(401);
  }
);
/* eslint-enable @silverhand/fp/no-let, @silverhand/fp/no-mutation */

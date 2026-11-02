/** Signed caller fixtures only. No production key or deployment state is used. */
import { buildOrganizationUrn } from '@logto/core-kit';
import { defaultManagementApi, getTenantOrganizationId } from '@logto/schemas';
import { createMockUtils } from '@logto/shared/esm';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import Koa from 'koa';
import Router from 'koa-router';
import Sinon from 'sinon';

import { EnvSet } from '#src/env-set/index.js';
import koaReadOnlyAccess from '#src/middleware/koa-read-only-access.js';
import type { ManagementApiRouter } from '#src/routes/types.js';

import { MockTenant } from './tenant.js';

const { jest } = import.meta;
const { mockEsmWithActual } = createMockUtils(jest);
const admin = await generateKeyPair('RS256');
const native = await generateKeyPair('RS256');
const adminKey = { ...(await exportJWK(admin.publicKey)), kid: 'admin', alg: 'RS256' };
const nativeKey = { ...(await exportJWK(native.publicKey)), kid: 'native', alg: 'RS256' };
await mockEsmWithActual('#src/middleware/koa-auth/utils.js', () => ({
  getAdminTenantTokenValidationSet: async () => ({
    keys: [adminKey],
    issuer: ['https://admin.example/oidc'],
  }),
}));
const { default: koaAuth } = await import('#src/middleware/koa-auth/index.js');
const { default: kuboRoutes } = await import('#src/routes/kubo.js');
export const proofKey = Buffer.from('public-unit-test-key-at-least-32-bytes');
export const maybeOne = jest.fn();

export const token = async ({
  nativeSigner = false,
  issuer = 'https://admin.example/oidc',
  machine = false,
  tenantId = 'tenant-a',
} = {}) =>
  new SignJWT({ scope: 'all', ...(machine ? { client_id: 'operator' } : {}) })
    .setProtectedHeader({ alg: 'RS256', kid: nativeSigner ? 'native' : 'admin' })
    .setIssuer(issuer)
    .setAudience(
      machine
        ? defaultManagementApi.resource.indicator
        : buildOrganizationUrn(getTenantOrganizationId(tenantId))
    )
    .setSubject('operator')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(nativeSigner ? native.privateKey : admin.privateKey);

export const createApp = (tenantId = 'tenant-a') => {
  const app = new Koa();
  const router: ManagementApiRouter = new Router();
  const tenant = new MockTenant();
  Sinon.stub(tenant, 'id').value(tenantId);
  Sinon.stub(tenant.envSet, 'tenantId').value(tenantId);
  Sinon.stub(tenant.envSet, 'oidc').value({
    publicJwks: [nativeKey],
    issuer: 'https://native.example/oidc',
  });
  app.use(async (ctx, next) => {
    try {
      await next();
    } catch (error) {
      ctx.status = error instanceof Error && 'status' in error ? Number(error.status) : 500;
      ctx.body = { error: 'rejected' };
    }
  });
  app.use(
    koaAuth(tenant.envSet, [
      buildOrganizationUrn(getTenantOrganizationId(tenantId)),
      defaultManagementApi.resource.indicator,
    ])
  );
  app.use(koaReadOnlyAccess());
  kuboRoutes(router, tenant);
  app.use(router.routes());
  return app.callback();
};

export const setupKuboTest = () => {
  Sinon.stub(EnvSet, 'values').value({
    ...EnvSet.values,
    isProduction: true,
    isIntegrationTest: false,
  });
  Sinon.stub(EnvSet, 'sharedPool').value(Promise.resolve({ maybeOne }));
  maybeOne
    .mockReset()
    .mockResolvedValue({ id: 'operator', userId: 'operator', isSuspended: false });
  process.env.KUBO_CONSOLE_PROXY_KEY = proofKey.toString('base64');
};

export const cleanupKuboTest = () => {
  Sinon.restore();
  jest.restoreAllMocks();
  Reflect.deleteProperty(process.env, 'KUBO_CONSOLE_PROXY_KEY');
};

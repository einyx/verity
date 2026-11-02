import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import Koa from 'koa';
import Router from 'koa-router';
import request from 'supertest';

import type { EnvSet } from '#src/env-set/index.js';
import type TenantContext from '#src/tenants/TenantContext.js';

import type { ManagementApiRouter } from './types.js';

const { jest } = import.meta;
const ownerId = 'abcdefghijklmnopqrstu';
const session = {
  id: 'session',
  title: 'Private history',
  archivedAt: null,
  revision: 0,
  transcriptRevision: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
const access = jest.fn(async () => ({ items: [session], nextCursor: null }));
const operation = jest.fn(async () => true);
jest.unstable_mockModule('#src/env-set/index.js', () => ({
  EnvSet: { values: { isProduction: true, isUnitTest: true } },
  getTenantEndpoint: jest.fn(),
}));
// Resolve this dependency before the mocked store is linked by either router.
const { ChatSessionStoreError } = await import('./ai-chat-session-operation.js');
jest.unstable_mockModule('./ai-chat-session-store.js', () => ({
  ChatSessionStoreError,
  createChatSessionStore: () => ({ list: access }),
}));
jest.unstable_mockModule('./ai-chat-session-actions.js', () => ({
  createSessionActionStore: () => ({
    getSessionReviews: access,
    refreshSessionReview: access,
    withSessionActionOperation: operation,
  }),
}));
jest.unstable_mockModule('./ai-chat-session-turn-store.js', () => ({
  createChatTurnStore: () => ({ get: access }),
}));
const { default: koaAuth } = await import('#src/middleware/koa-auth/index.js');
const { default: sessions } = await import('./ai-chat-sessions.js');
const { default: actions } = await import('./ai-chat.js');
const { privateKey, publicKey } = await generateKeyPair('ES256');
const envSet = {
  tenantId: 'admin',
  pool: {},
  endpoint: new URL('https://tenant.example'),
  oidc: { publicJwks: [await exportJWK(publicKey)], issuer: 'https://tenant.example/oidc' },
};
const token = async (app: boolean) =>
  new SignJWT({
    client_id: app ? ownerId : 'console',
    scope: 'all',
  })
    .setProtectedHeader({ alg: 'ES256' })
    .setSubject(ownerId)
    .setIssuer(envSet.oidc.issuer)
    .setAudience('management')
    .setExpirationTime('1h')
    .sign(privateKey);
const app = new Koa();
const router = new Router();
app.use(async (ctx, next) => {
  ctx.request.body = JSON.parse(ctx.get('test-body') || '{}') as NonNullable<
    typeof ctx.request.body
  >;
  await next();
});
app.use(koaAuth(envSet as unknown as EnvSet, 'management'));
sessions(
  router as unknown as ManagementApiRouter,
  { id: 'admin', envSet } as unknown as TenantContext
);
actions(
  router as unknown as ManagementApiRouter,
  { id: 'admin', envSet } as unknown as TenantContext
);
app.use(router.routes());
beforeEach(() => {
  jest.clearAllMocks();
});

it('authenticates a human with the colliding ID and retains private session reads', async () => {
  await request(app.callback())
    .get('/ai-chat/sessions')
    .auth(await token(false), { type: 'bearer' })
    .expect(200, { items: [session], nextCursor: null });
  expect(access).toHaveBeenCalledWith({ tenantId: 'admin', userId: ownerId }, expect.anything());
});

it.each([
  ['get', '/ai-chat/sessions'],
  ['post', '/ai-chat/sessions'],
  ['get', '/ai-chat/sessions/session'],
  ['patch', '/ai-chat/sessions/session'],
  ['delete', '/ai-chat/sessions/session?expectedRevision=0'],
  ['get', '/ai-chat/sessions/session/messages'],
  ['get', '/ai-chat/sessions/session/composer'],
  ['put', '/ai-chat/sessions/session/composer'],
  ['post', '/ai-chat/sessions/session/turns'],
  ['get', '/ai-chat/sessions/session/turns'],
  ['get', '/ai-chat/sessions/session/turns/10000000-0000-4000-8000-000000000000'],
  ['get', '/ai-chat/sessions/session/reviews'],
  ['post', '/ai-chat/sessions/session/reviews/original/refresh'],
  ['post', '/ai-chat/sessions/session/reviews/action/confirm'],
  ['post', '/ai-chat/sessions/session/reviews/action/cancel'],
  ['post', '/ai-chat/actions/action/confirm'],
  ['post', '/ai-chat/actions/action/cancel'],
] as const)(
  'rejects authenticated colliding app before owner scope: %s %s',
  async (method, path) => {
    await request(app.callback())
      [method](path)
      .auth(await token(true), { type: 'bearer' })
      .expect(403);
    expect(access).not.toHaveBeenCalled();
    expect(operation).not.toHaveBeenCalled();
  }
);

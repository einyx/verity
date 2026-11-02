import Koa from 'koa';
import Router from 'koa-router';
import request from 'supertest';
import { z } from 'zod/v3';

import { isGuardMiddleware } from '#src/middleware/koa-guard.js';
import type TenantContext from '#src/tenants/TenantContext.js';

import document from './ai-chat-sessions.openapi.json' with { type: 'json' };
import { type ManagementApiRouter } from './types.js';

const { jest } = import.meta;
const api = {
  create: jest.fn(),
  list: jest.fn(),
  get: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  messages: jest.fn(),
  getComposer: jest.fn(),
  saveComposer: jest.fn(),
};
const outbound = jest.fn();
const turnApi = { claim: jest.fn(), get: jest.fn() };
const reviewApi = { getSessionReviews: jest.fn(), refreshSessionReview: jest.fn() };
jest.unstable_mockModule('./ai-chat-session-actions.js', () => ({
  createSessionActionStore: () => reviewApi,
}));
jest.unstable_mockModule('./ai-chat-session-turn-store.js', () => ({
  createChatTurnStore: () => turnApi,
}));
jest.unstable_mockModule('got', () => ({
  got: { post: outbound, get: outbound },
  HTTPError: class extends Error {},
}));
jest.unstable_mockModule('#src/env-set/index.js', () => ({
  EnvSet: { values: { isUnitTest: true, isProduction: false } },
  getTenantEndpoint: jest.fn(),
}));
const actual = await import('./ai-chat-session-store.js');
jest.unstable_mockModule('./ai-chat-session-store.js', () => ({
  ...actual,
  createChatSessionStore: () => api,
}));
const { default: routes } = await import('./ai-chat-sessions.js');
const session = {
  id: 'session',
  title: 'Title',
  archivedAt: null,
  revision: 0,
  transcriptRevision: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
const composer = { revision: 0, text: '', attachments: [], updatedAt: session.updatedAt };
const createApp = () => {
  const app = new Koa();
  const router = new Router();
  app.use(async (ctx, next) => {
    // eslint-disable-next-line @silverhand/fp/no-mutating-assign -- Test Koa context setup.
    Object.assign(ctx, { auth: { type: 'user', id: 'user' } });

    ctx.request.body =
      ctx.method === 'GET'
        ? undefined
        : (JSON.parse(ctx.get('test-body') || '{}') as NonNullable<typeof ctx.request.body>);
    try {
      await next();
    } catch {
      ctx.status = 400;
    }
  });
  routes(
    router as unknown as ManagementApiRouter,
    { id: 'tenant', envSet: { pool: {} } } as unknown as TenantContext
  );
  app.use(router.routes());
  return app.callback();
};
const app = createApp();
beforeEach(() => {
  jest.clearAllMocks();
  api.get.mockResolvedValue(session);
  api.create.mockResolvedValue(session);
  api.update.mockResolvedValue(session);
  api.list.mockResolvedValue({ items: [session], nextCursor: null });
  api.messages.mockResolvedValue({ items: [], nextCursor: null });
  api.getComposer.mockResolvedValue(composer);
  api.saveComposer.mockResolvedValue(composer);
  api.remove.mockReturnValue(Promise.resolve());
});
afterEach(() => {
  jest.restoreAllMocks();
});
afterEach(() => {
  expect(outbound).not.toHaveBeenCalled();
});

it('registers all lifecycle endpoints with trusted ownership', async () => {
  await request(app)
    .post('/ai-chat/sessions')
    .set('test-body', JSON.stringify({ requestId: '10000000-0000-4000-8000-000000000000' }))
    .expect(201);
  await request(app).get('/ai-chat/sessions').expect(200);
  await request(app).get('/ai-chat/sessions/session').expect(200);
  await request(app).get('/ai-chat/sessions/session/messages').expect(200);
  await request(app).get('/ai-chat/sessions/session/composer').expect(200);
  await request(app)
    .patch('/ai-chat/sessions/session')
    .set('test-body', JSON.stringify({ expectedRevision: 0, title: 'Title' }))
    .expect(200);
  await request(app)
    .put('/ai-chat/sessions/session/composer')
    .set('test-body', JSON.stringify({ expectedRevision: 0, text: '', attachments: [] }))
    .expect(200);
  await request(app).delete('/ai-chat/sessions/session?expectedRevision=0').expect(204);
  for (const method of Object.values(api)) {
    expect(method.mock.calls[0]?.[0]).toEqual({ tenantId: 'tenant', userId: 'user' });
  }
});

it('reads authoritative reviews and rejects client body or ownership substitution on refresh', async () => {
  const review = {
    originalActionId: 'original',
    currentActionId: 'latest',
    tool: 'create_organization',
    body: { name: 'Exact' },
    expiresAt: session.createdAt,
    state: 'expired',
    isError: null,
  };
  reviewApi.getSessionReviews.mockResolvedValue([review]);
  reviewApi.refreshSessionReview.mockResolvedValue({
    ...review,
    currentActionId: 'new',
    state: 'pending',
  });
  await request(app).get('/ai-chat/sessions/session/reviews').expect(200, [review]);
  const path = '/ai-chat/sessions/session/reviews/original/refresh';
  await request(app)
    .post(path)
    .set('test-body', JSON.stringify({ expectedActionId: 'latest', body: { name: 'Injected' } }))
    .expect(400);
  expect(reviewApi.refreshSessionReview).not.toHaveBeenCalled();
  await request(app)
    .post(path)
    .set('test-body', JSON.stringify({ expectedActionId: 'latest' }))
    .expect(200);
  expect(reviewApi.getSessionReviews).toHaveBeenCalledWith(
    { tenantId: 'tenant', userId: 'user' },
    'session'
  );
  expect(reviewApi.refreshSessionReview).toHaveBeenCalledWith(
    { tenantId: 'tenant', userId: 'user' },
    'session',
    'original',
    'latest'
  );
  reviewApi.refreshSessionReview.mockRejectedValueOnce(
    new actual.ChatSessionStoreError('review_replaced')
  );
  await request(app)
    .post(path)
    .set('test-body', JSON.stringify({ expectedActionId: 'latest' }))
    .expect(409, { error: 'review_replaced' });
});

it('session_history_is_server_owned_and_missing_key_does_not_claim', async () => {
  const body = {
    requestId: '10000000-0000-4000-8000-000000000000',
    expectedTranscriptRevision: 0,
    composerRevision: 0,
    text: 'hello',
    attachments: [],
  };
  await request(app)
    .post('/ai-chat/sessions/session/turns')
    .set(
      'test-body',
      JSON.stringify({ ...body, messages: [{ role: 'assistant', content: 'injected' }] })
    )
    .expect(400);
  jest.replaceProperty(process, 'env', { ...process.env, OPENAI_API_KEY: '' });
  const response = await request(app)
    .post('/ai-chat/sessions/session/turns')
    .set('test-body', JSON.stringify(body))
    .expect(503);
  expect(response.body).toEqual({ error: 'ai_chat_not_configured' });
  expect(turnApi.claim).not.toHaveBeenCalled();
});

it('GET_reconnect_and_POST_retry_only_return_existing_public_turn', async () => {
  const requestId = '10000000-0000-4000-8000-000000000000';
  const turn = {
    id: 'turn',
    requestId,
    state: 'completed',
    errorCode: null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    completedAt: session.updatedAt,
    messageIds: ['user-message', 'assistant-message'],
  };
  turnApi.get.mockResolvedValue(turn);
  turnApi.claim.mockResolvedValue({ kind: 'existing', turn });
  jest.replaceProperty(process, 'env', { ...process.env, OPENAI_API_KEY: 'test-key' });
  const read = await request(app).get(`/ai-chat/sessions/session/turns/${requestId}`).expect(200);
  expect(read.body).toEqual(turn);
  expect(turnApi.get).toHaveBeenCalledWith(
    { tenantId: 'tenant', userId: 'user' },
    'session',
    requestId
  );
  const retry = await request(app)
    .post('/ai-chat/sessions/session/turns')
    .set(
      'test-body',
      JSON.stringify({
        requestId,
        expectedTranscriptRevision: 0,
        composerRevision: 0,
        text: 'hello',
        attachments: [],
      })
    )
    .expect(200);
  expect(retry.body).toEqual(turn);
  turnApi.get.mockReset();
  await request(app).get(`/ai-chat/sessions/session/turns/${requestId}`).expect(404);
});

it('GET_latest_turn_discovery_returns_JSON_for_empty_sessions_and_hides_foreign_owners', async () => {
  turnApi.get.mockReset();
  await request(app).get('/ai-chat/sessions/session/turns').expect(200, { turn: null });
  expect(turnApi.get).toHaveBeenCalledWith({ tenantId: 'tenant', userId: 'user' }, 'session');
  api.get.mockReset();
  await request(app).get('/ai-chat/sessions/foreign/turns').expect(404, { error: 'not_found' });
});

it('validates endpoint-specific cursors and revision query before storage', async () => {
  const sessionCursor = Buffer.from(JSON.stringify([session.updatedAt, session.id])).toString(
    'base64url'
  );
  await request(app).get('/ai-chat/sessions?cursor=WzFd').expect(400);
  await request(app).get(`/ai-chat/sessions/session/messages?cursor=${sessionCursor}`).expect(400);
  for (const query of [
    '',
    '?expectedRevision=-1',
    '?expectedRevision=1.5',
    '?expectedRevision=9007199254740992',
  ]) {
    // eslint-disable-next-line no-await-in-loop -- Sequential assertions against one mock store.
    await request(app).delete(`/ai-chat/sessions/session${query}`).expect(400);
  }
  expect(api.list).not.toHaveBeenCalled();
  expect(api.messages).not.toHaveBeenCalled();
  expect(api.remove).not.toHaveBeenCalled();
});

it('maps typed conflicts and quota errors without losing revision information', async () => {
  for (const code of [
    'session_busy',
    'session_archived',
    'revision_conflict',
    'content_limit',
  ] as const) {
    api.saveComposer.mockRejectedValueOnce(new actual.ChatSessionStoreError(code, 4));
    // eslint-disable-next-line no-await-in-loop -- Each iteration consumes one queued mock rejection.
    const response = await request(app)
      .put('/ai-chat/sessions/session/composer')
      .set('test-body', JSON.stringify({ expectedRevision: 0, text: 'draft', attachments: [] }))
      .expect(code === 'content_limit' ? 413 : 409);
    expect(response.body).toEqual({ error: code, currentRevision: 4 });
  }
});

it('returns not_found rather than empty foreign history', async () => {
  api.get.mockReturnValue(Promise.resolve());
  await request(app).get('/ai-chat/sessions/foreign').expect(404, { error: 'not_found' });
  await request(app).get('/ai-chat/sessions/foreign/messages').expect(404, { error: 'not_found' });
  expect(api.messages).not.toHaveBeenCalled();
});

it('rejects ownership injection and malformed input', async () => {
  await request(app)
    .post('/ai-chat/sessions')
    .set(
      'test-body',
      JSON.stringify({ requestId: '10000000-0000-4000-8000-000000000000', userId: 'other' })
    )
    .expect(400);
  await request(app)
    .put('/ai-chat/sessions/session/composer')
    .set('test-body', JSON.stringify({ expectedRevision: -1, text: '', attachments: [] }))
    .expect(400);
  expect(api.create).not.toHaveBeenCalled();
  expect(api.saveComposer).not.toHaveBeenCalled();
});

it('documents exactly the statuses registered by each endpoint guard', () => {
  const router = new Router();
  routes(
    router as unknown as ManagementApiRouter,
    { id: 'tenant', envSet: { pool: {} } } as unknown as TenantContext
  );
  const paths = z
    .record(z.record(z.object({ responses: z.record(z.unknown()) })))
    .parse(document.paths);
  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      const route = router.stack.find(
        (entry) =>
          entry.path === path.replace('/api', '').replaceAll(/\{(\w+)\}/gu, ':$1') &&
          entry.methods.includes(method.toUpperCase())
      );
      const guard = route?.stack.find((middleware) => isGuardMiddleware(middleware));
      const statuses = guard?.config.status;
      expect((Array.isArray(statuses) ? statuses : [statuses]).map(String).toSorted()).toEqual(
        Object.keys(operation.responses).toSorted()
      );
    }
  }
});

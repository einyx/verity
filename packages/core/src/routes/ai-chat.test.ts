import Koa from 'koa';
import Router from 'koa-router';
import request from 'supertest';

import type TenantContext from '#src/tenants/TenantContext.js';

import { type confirmPendingAction as ConfirmPendingAction } from './ai-chat-actions.js';
import { type proposeLandingPageEdit as ProposeLandingPageEdit } from './ai-chat-landing-page-action.js';
import { type runToolLoop as RunToolLoop } from './ai-chat-loop.js';
import { ChatSessionStoreError } from './ai-chat-session-operation.js';
import { type ManagementApiRouter } from './types.js';

const { jest } = import.meta;
type ConfirmOptions = Parameters<typeof ConfirmPendingAction>[0];
type LoopOptions = Parameters<typeof RunToolLoop>[0];
type ProposalOptions = Parameters<typeof ProposeLandingPageEdit>[0];

// The isUnitTest flag lets koaGuard fall back to a silent logger instead of needing a console.
const envValues = {
  isDevFeaturesEnabled: true,
  isProduction: false,
  isUnitTest: true,
  cloudUrlSet: { endpoint: new URL('https://console.example.com') },
};

const confirmPendingAction = jest.fn();
const cancelPendingAction = jest.fn();
const proposePendingAction = jest.fn();
const proposeAndRecordAction = jest.fn();
const getLandingPageAiToken = jest.fn();
const proposeLandingPageEdit = jest.fn();
const runToolLoopWithGraph = jest.fn();
const modelPost = jest.fn();
const sessionOperation = jest.fn();
jest.unstable_mockModule('./ai-chat-session-actions.js', () => ({
  createSessionActionStore: () => ({ withSessionActionOperation: sessionOperation }),
}));

jest.unstable_mockModule('./ai-chat-landing-page-auth.js', () => ({ getLandingPageAiToken }));
jest.unstable_mockModule('./ai-chat-landing-page-action.js', () => ({ proposeLandingPageEdit }));
jest.unstable_mockModule('./ai-chat-graph.js', () => ({ runToolLoopWithGraph }));
jest.unstable_mockModule('got', () => ({
  got: {
    // eslint-disable-next-line @typescript-eslint/promise-function-async -- Preserve Got's augmented promise interface.
    post: (...args: unknown[]) =>
      // eslint-disable-next-line @silverhand/fp/no-mutating-assign -- Synthetic Got request interface.
      Object.assign(modelPost(...args) as Promise<unknown>, {
        on: () => {
          /* No download in this route fixture. */
        },
      }),
  },
  HTTPError: class extends Error {},
}));

jest.unstable_mockModule('#src/env-set/index.js', () => ({
  EnvSet: { values: envValues },
  getTenantEndpoint: jest.fn(),
}));

jest.unstable_mockModule('./ai-chat-actions.js', () => ({
  confirmPendingAction,
  proposePendingAction,
  proposeAndRecordAction,
  createPendingActionStore: () => ({ cancel: cancelPendingAction }),
}));

const { default: aiChatRoutes, buildSystemPrompt } = await import('./ai-chat.js');
const { enabledLogtoMcpTools } = await import('./mcp-logto-tools.js');

describe('buildSystemPrompt', () => {
  it('names each tool the server will run, with its description', () => {
    const tools = enabledLogtoMcpTools(true);
    const prompt = buildSystemPrompt(tools);

    for (const { name, description } of tools) {
      expect(prompt).toContain(`- ${name}: ${description}`);
    }

    // The capability answer must also say what the assistant cannot do yet.
    expect(prompt).toContain('changing tenant settings');
    expect(prompt).toContain('deleting anything');
  });

  it('says it cannot read the tenant when no tools are offered', () => {
    const prompt = buildSystemPrompt([]);

    expect(prompt).toContain('cannot read or change this tenant');
    expect(prompt).not.toContain('Tools:');
  });
});

const tenant = {
  id: 'tenant-1',
  envSet: { pool: {}, endpoint: new URL('https://logto.example.com') },
};

/** Builds an app where the caller is `userId`, and `bearer` decides whether a token is sent. */
const createApp = (userId = 'user-a') => {
  const app = new Koa();
  const router = new Router();

  app.use(async (ctx, next) => {
    // eslint-disable-next-line @silverhand/fp/no-mutating-assign -- Koa context is mutable by design; this sets the auth the route reads.
    Object.assign(ctx, { auth: { type: 'user', id: userId } });
    await next();
  });

  aiChatRoutes(router as unknown as ManagementApiRouter, tenant as unknown as TenantContext);
  app.use(router.routes()).use(router.allowedMethods());

  return app.callback();
};

const bearer = { authorization: 'Bearer caller-token' };

beforeEach(() => {
  // eslint-disable-next-line @silverhand/fp/no-mutation -- Each case sets the mocked env flag it needs.
  envValues.isDevFeaturesEnabled = true;
  // eslint-disable-next-line @silverhand/fp/no-mutation -- Restore the mocked environment between cases.
  envValues.isProduction = false;
  confirmPendingAction.mockReset();
  sessionOperation
    .mockReset()
    .mockImplementation(
      async (
        _scope,
        _id,
        _operation,
        execute: (store: unknown, assertActive: () => Promise<void>) => Promise<unknown>
      ) =>
        execute({ cancel: cancelPendingAction }, async () => {
          /* Unlinked action test. */
        })
    );
  cancelPendingAction.mockReset();
  proposePendingAction.mockReset();
  getLandingPageAiToken.mockReset();
  proposeLandingPageEdit.mockReset();
  runToolLoopWithGraph
    .mockReset()
    .mockResolvedValue({ ok: true, content: 'Production graph response' });
  modelPost
    .mockReset()
    .mockResolvedValue({ body: { choices: [{ message: { content: 'Legacy loop response' } }] } });
});

afterEach(() => {
  jest.restoreAllMocks();
});

it.each([
  ['confirm', '/ai-chat/actions'],
  ['cancel', '/ai-chat/actions'],
  ['confirm', '/ai-chat/sessions/session/reviews'],
  ['cancel', '/ai-chat/sessions/session/reviews'],
])('guards %s on %s before calling action machinery', async (kind, prefix) => {
  sessionOperation.mockRejectedValueOnce(new ChatSessionStoreError('session_archived'));
  await request(createApp())
    .post(`${prefix}/action/${kind}`)
    .set(bearer)
    .expect(409, { error: 'session_archived' });
  expect(confirmPendingAction).not.toHaveBeenCalled();
  expect(cancelPendingAction).not.toHaveBeenCalled();
  expect(sessionOperation).toHaveBeenLastCalledWith(
    { tenantId: 'tenant-1', userId: 'user-a' },
    'action',
    { kind, sessionId: prefix.includes('sessions') ? 'session' : undefined },
    expect.any(Function)
  );
});

it('uses the same-user Cloud credential and Cloud origin for landing-page proposals', async () => {
  jest.replaceProperty(process, 'env', { ...process.env, OPENAI_API_KEY: 'test-key' });
  getLandingPageAiToken.mockResolvedValue('cloud-token');
  proposeLandingPageEdit.mockImplementation(async ({ getToken }: ProposalOptions) => {
    expect(await getToken?.()).toBe('cloud-token');
    return { response: '{"proposed":true}' };
  });
  runToolLoopWithGraph.mockImplementation(async ({ executeTool }: LoopOptions) => ({
    ok: true,
    content: await executeTool({
      id: 'call-1',
      function: {
        name: 'edit_landing_page',
        arguments: '{"instruction":"Improve the hero"}',
      },
    }),
  }));

  const response = await request(createApp())
    .post('/ai-chat/completions')
    .set(bearer)
    .set('x-landing-page-authorization', 'Bearer cloud-token')
    .send({ messages: [{ role: 'user', content: 'Improve the hero' }] });

  expect(response.status).toBe(200);
  expect(getLandingPageAiToken).toHaveBeenCalledWith(tenant.envSet, 'Bearer cloud-token', 'user-a');
  expect(proposeLandingPageEdit).toHaveBeenCalledWith(
    expect.objectContaining({
      apiBase: 'https://console.example.com/api',
      userId: 'user-a',
    })
  );
});

describe('production Ask AI execution', () => {
  it('uses graph execution with dev features disabled and does not execute a write', async () => {
    // eslint-disable-next-line @silverhand/fp/no-mutation -- Explicitly exercise the production flag-off configuration.
    envValues.isDevFeaturesEnabled = false;
    // eslint-disable-next-line @silverhand/fp/no-mutation -- Explicitly exercise production behavior.
    envValues.isProduction = true;
    jest.replaceProperty(process, 'env', { ...process.env, OPENAI_API_KEY: 'test-only-ai-key' });
    const response = await request(createApp())
      .post('/ai-chat/completions')
      .set(bearer)
      .send({ messages: [{ role: 'user', content: 'What can you do?' }] });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ content: 'Production graph response', actions: [] });
    expect(confirmPendingAction).not.toHaveBeenCalled();
  });
});

describe('POST /ai-chat/actions/:id/confirm', () => {
  it('revalidates the Cloud credential when confirming a landing-page draft save', async () => {
    getLandingPageAiToken.mockResolvedValue('fresh-cloud-token');
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
    confirmPendingAction.mockImplementation(async ({ execute }: ConfirmOptions) => ({
      ok: true,
      result: await execute(
        {
          name: 'save_landing_page_draft',
          description: 'Save the confirmed draft',
          path: '/landing-page/draft',
          method: 'PUT',
          properties: {},
        },
        { sections: [] }
      ),
    }));

    const response = await request(createApp())
      .post('/ai-chat/actions/action-1/confirm')
      .set(bearer)
      .set('x-landing-page-authorization', 'Bearer fresh-cloud-token');

    expect(response.status).toBe(200);
    expect(getLandingPageAiToken).toHaveBeenCalledWith(
      tenant.envSet,
      'Bearer fresh-cloud-token',
      'user-a'
    );
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      'https://console.example.com/api/landing-page/draft'
    );
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
      headers: { authorization: 'Bearer fresh-cloud-token' },
    });
  });

  it('keeps ordinary Management API writes on the tenant token and endpoint', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
    confirmPendingAction.mockImplementation(async ({ execute }: ConfirmOptions) => ({
      ok: true,
      result: await execute(
        {
          name: 'create_organization',
          description: 'Create an organization',
          path: '/organizations',
          method: 'POST',
          properties: {},
        },
        { name: 'Team' }
      ),
    }));
    await request(createApp()).post('/ai-chat/actions/action-1/confirm').set(bearer);
    expect(getLandingPageAiToken).not.toHaveBeenCalled();
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe('https://logto.example.com/api/organizations');
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
      headers: { authorization: 'Bearer caller-token' },
    });
  });

  it('returns the Management API result when the action runs', async () => {
    confirmPendingAction.mockResolvedValue({
      ok: true,
      result: { content: [{ type: 'text', text: '{"id":"org-1"}' }], isError: false },
    });

    const response = await request(createApp())
      .post('/ai-chat/actions/action-1/confirm')
      .set(bearer);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      result: { content: [{ type: 'text', text: '{"id":"org-1"}' }], isError: false },
    });
  });

  it('passes the caller id and tenant id, and never a payload from the client', async () => {
    confirmPendingAction.mockResolvedValue({ ok: false, code: 'not_found' });

    await request(createApp('user-a'))
      .post('/ai-chat/actions/action-1/confirm')
      .set(bearer)
      .send({ body: { name: 'attacker-chosen' } });

    expect(confirmPendingAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'action-1', tenantId: 'tenant-1', userId: 'user-a' })
    );
    expect(confirmPendingAction.mock.calls[0]?.[0]).not.toHaveProperty('body');
  });

  it('refuses without a bearer token and does not touch the action', async () => {
    const response = await request(createApp()).post('/ai-chat/actions/action-1/confirm');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'missing_bearer_token' });
    expect(confirmPendingAction).not.toHaveBeenCalled();
  });

  it.each([
    ['not_found', 404],
    ['not_pending', 409],
    ['tampered', 409],
    ['expired', 410],
    ['unknown_tool', 400],
  ] as const)('maps the %s outcome to HTTP %i', async (code, status) => {
    confirmPendingAction.mockResolvedValue({ ok: false, code });

    const response = await request(createApp())
      .post('/ai-chat/actions/action-1/confirm')
      .set(bearer);

    expect(response.status).toBe(status);
    expect(response.body).toEqual({ error: code });
  });
});

describe('POST /ai-chat/actions/:id/cancel', () => {
  it('cancels a pending action of the caller', async () => {
    cancelPendingAction.mockResolvedValue(true);

    const response = await request(createApp()).post('/ai-chat/actions/action-1/cancel');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ cancelled: true });
    expect(cancelPendingAction).toHaveBeenCalledWith('action-1', 'tenant-1', 'user-a');
  });

  it('answers 404 when the action is not pending or belongs to someone else', async () => {
    cancelPendingAction.mockResolvedValue(false);

    const response = await request(createApp()).post('/ai-chat/actions/action-1/cancel');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'not_found' });
  });
});

describe('POST /ai-chat/actions', () => {
  it('stores a proposal and returns its body for review, without running it', async () => {
    const expiresAt = new Date('2026-10-18T10:05:00.000Z');
    proposePendingAction.mockResolvedValue({
      ok: true,
      action: {
        id: 'action-1',
        tool: 'create_organization',
        body: { name: 'Team' },
        expiresAt,
      },
    });

    const response = await request(createApp())
      .post('/ai-chat/actions')
      .send({ tool: 'create_organization', arguments: { name: 'Team' } });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: 'action-1',
      tool: 'create_organization',
      body: { name: 'Team' },
      expiresAt: expiresAt.toISOString(),
    });
    expect(confirmPendingAction).not.toHaveBeenCalled();
  });

  it('answers 400 for a tool that is not a write', async () => {
    proposePendingAction.mockResolvedValue({ ok: false, code: 'unknown_tool' });

    const response = await request(createApp())
      .post('/ai-chat/actions')
      .send({ tool: 'list_users', arguments: {} });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'unknown_tool' });
  });
});

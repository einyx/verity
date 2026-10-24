import Koa from 'koa';
import Router from 'koa-router';
import request from 'supertest';

import type TenantContext from '#src/tenants/TenantContext.js';

import { type ManagementApiRouter } from './types.js';

const { jest } = import.meta;

// The isUnitTest flag lets koaGuard fall back to a silent logger instead of needing a console.
const envValues = { isDevFeaturesEnabled: true, isProduction: false, isUnitTest: true };

const confirmPendingAction = jest.fn();
const cancelPendingAction = jest.fn();
const proposePendingAction = jest.fn();

jest.unstable_mockModule('#src/env-set/index.js', () => ({
  EnvSet: { values: envValues },
  getTenantEndpoint: jest.fn(),
}));

jest.unstable_mockModule('./ai-chat-actions.js', () => ({
  confirmPendingAction,
  proposePendingAction,
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
    expect(prompt).toContain('changing settings');
    expect(prompt).toContain('configuring MFA');
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
    Object.assign(ctx, { auth: { id: userId } });
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
  confirmPendingAction.mockReset();
  cancelPendingAction.mockReset();
  proposePendingAction.mockReset();
});

describe('POST /ai-chat/actions/:id/confirm', () => {
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

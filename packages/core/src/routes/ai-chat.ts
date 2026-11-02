import { extractBearerToken } from '@logto/mcp-portal';
import { array, object, string, z } from 'zod/v3';

import { EnvSet } from '#src/env-set/index.js';
import koaGuard from '#src/middleware/koa-guard.js';

import {
  confirmPendingAction,
  createPendingActionStore,
  proposePendingAction,
  type ConfirmResult,
} from './ai-chat-actions.js';
import { getLandingPageAiToken } from './ai-chat-landing-page-auth.js';
import { resolveLandingPageCapability } from './ai-chat-landing-page-capability.js';
import { saveLandingPageDraftTool } from './ai-chat-landing-page.js';
import { runChatCompletion } from './ai-chat-runner.js';
import { createSessionActionStore } from './ai-chat-session-actions.js';
import { ChatSessionStoreError } from './ai-chat-session-operation.js';
import { requireChatUser } from './ai-chat-user.js';
import { buildLogtoToolUrl, sendLogtoRequest } from './mcp-logto-tools.js';
import type { ManagementApiRouter, ManagementApiRouterContext, RouterInitArgs } from './types.js';

export { buildSystemPrompt } from './ai-chat-runner.js';

const messageGuard = object({
  role: z.enum(['user', 'assistant']),
  content: string().min(1).max(8000),
});

const confirmStatus: Record<Exclude<ConfirmResult, { ok: true }>['code'], number> = {
  not_found: 404,
  not_pending: 409,
  expired: 410,
  tampered: 409,
  unknown_tool: 400,
};

const bearer = (ctx: ManagementApiRouterContext) => {
  try {
    return extractBearerToken(ctx.get('authorization'));
  } catch {
    return null;
  }
};

const landingPageApiBase = () => `${EnvSet.values.cloudUrlSet.endpoint.origin}/api`;

const actionErrors = async (ctx: ManagementApiRouterContext, next: () => Promise<unknown>) => {
  try {
    await next();
  } catch (error) {
    if (!(error instanceof ChatSessionStoreError)) {
      throw error;
    }
    ctx.status = error.code === 'not_found' ? 404 : 409;
    ctx.body = { error: error.code };
  }
};

export default function aiChatRoutes<T extends ManagementApiRouter>(
  ...[router, tenant]: RouterInitArgs<T>
) {
  // Management API calls are made on the same origin as this endpoint, under /api, with the
  // caller's own token, so the Management API decides what each user can create.
  const apiBase = () => `${tenant.envSet.endpoint.origin}/api`;
  const editorToken = async (ctx: ManagementApiRouterContext) =>
    getLandingPageAiToken(tenant.envSet, ctx.get('x-landing-page-authorization'), ctx.auth.id);

  // Metadata only: this uses the exact same verifier as proposal generation and explicit Save.
  router.get('/ai-chat/landing-page-capabilities', requireChatUser, async (ctx, next) => {
    const state = await resolveLandingPageCapability(async () => editorToken(ctx));
    ctx.set('Cache-Control', 'no-store');
    ctx.body = { canEdit: state === 'authorized', state };
    return next();
  });

  router.post(
    '/ai-chat/completions',
    koaGuard({
      body: object({
        messages: array(messageGuard).min(1).max(40),
      }),
      response: object({
        content: string().optional(),
        error: string().optional(),
        actions: z.array(z.unknown()).optional(),
      }),
      status: [200, 503],
    }),
    async (ctx, next) => {
      const apiKey = process.env.OPENAI_API_KEY;

      if (!apiKey) {
        ctx.status = 503;
        ctx.body = { error: 'ai_chat_not_configured' };

        return next();
      }

      const { messages } = ctx.guard.body;
      const outcome = await runChatCompletion({
        messages,
        credentials: {
          apiKey,
          token: bearer(ctx) ?? undefined,
          apiBase: apiBase(),
          landingPageApiBase: landingPageApiBase(),
          getEditorToken: async () => editorToken(ctx),
          userId: ctx.auth.id,
          tenantId: tenant.id,
          requestId: typeof ctx.requestId === 'string' ? ctx.requestId : undefined,
        },
        propose: createPendingActionStore(tenant.envSet.pool),
        assertActive: async () => {
          /* Legacy requests have no persisted lease. */
        },
      });

      if (!outcome.ok) {
        ctx.status = 503;
        ctx.body = { error: 'ai_chat_unavailable' };

        return next();
      }

      ctx.body = { content: outcome.content, actions: outcome.actions };

      return next();
    }
  );

  // Proposes a write. Nothing runs here: the stored body is returned so the user can review it.
  router.post(
    '/ai-chat/actions',
    koaGuard({
      body: object({ tool: string().min(1), arguments: z.record(z.unknown()) }),
      response: object({}).passthrough(),
      status: [201, 400, 404, 422],
    }),
    async (ctx, next) => {
      const { tool, arguments: args } = ctx.guard.body;
      const proposal = await proposePendingAction({
        store: createPendingActionStore(tenant.envSet.pool),
        tool,
        args,
        userId: ctx.auth.id,
        tenantId: tenant.id,
        now: new Date(),
      });

      if (!proposal.ok) {
        ctx.status = 400;
        ctx.body = { error: proposal.code };

        return next();
      }

      const { action } = proposal;
      ctx.status = 201;
      ctx.body = {
        id: action.id,
        tool: action.tool,
        body: action.body,
        expiresAt: action.expiresAt.toISOString(),
      };

      return next();
    }
  );

  const sessionActions = createSessionActionStore(tenant.envSet.pool);
  const registerActionRoutes = (path: string, sessionBound = false) => {
    // Both legacy and session routes pass the same persistent ownership/lifecycle gate.
    router.post(`${path}/:id/confirm`, requireChatUser, actionErrors, async (ctx, next) => {
      const token = bearer(ctx);

      if (!token) {
        ctx.status = 401;
        ctx.body = { error: 'missing_bearer_token' };

        return next();
      }

      const result = await sessionActions.withSessionActionOperation(
        { tenantId: tenant.id, userId: ctx.auth.id },
        ctx.params.id ?? '',
        { kind: 'confirm', sessionId: sessionBound ? ctx.params.sessionId : undefined },
        async (store, assertActive) =>
          confirmPendingAction({
            store,
            id: ctx.params.id ?? '',
            tenantId: tenant.id,
            userId: ctx.auth.id,
            now: new Date(),
            execute: async (logtoTool, body) => {
              await assertActive();
              const built = buildLogtoToolUrl(
                logtoTool,
                {},
                logtoTool.name === saveLandingPageDraftTool.name ? landingPageApiBase() : apiBase()
              );

              if ('error' in built) {
                throw new Error(built.error);
              }

              const actionToken =
                logtoTool.name === saveLandingPageDraftTool.name ? await editorToken(ctx) : token;
              await assertActive();
              const outcome = await sendLogtoRequest(logtoTool, built.url, body, actionToken);
              await assertActive();
              return outcome;
            },
          })
      );

      if (!result.ok) {
        ctx.status = confirmStatus[result.code];
        ctx.body = { error: result.code };

        return next();
      }

      ctx.status = 200;
      ctx.body = sessionBound
        ? { executed: true, isError: result.result.isError === true }
        : { result: result.result };

      return next();
    });

    // Cancels a proposal that has not been confirmed yet.
    router.post(`${path}/:id/cancel`, requireChatUser, actionErrors, async (ctx, next) => {
      const cancelled = await sessionActions.withSessionActionOperation(
        { tenantId: tenant.id, userId: ctx.auth.id },
        ctx.params.id ?? '',
        { kind: 'cancel', sessionId: sessionBound ? ctx.params.sessionId : undefined },
        async (store) => store.cancel(ctx.params.id ?? '', tenant.id, ctx.auth.id)
      );

      ctx.status = cancelled ? 200 : 404;
      ctx.body = cancelled ? { cancelled: true } : { error: 'not_found' };

      return next();
    });
  };
  registerActionRoutes('/ai-chat/actions');
  registerActionRoutes('/ai-chat/sessions/:sessionId/reviews', true);
}

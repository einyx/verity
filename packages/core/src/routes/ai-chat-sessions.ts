import { extractBearerToken } from '@logto/mcp-portal';
import {
  chatTurnGuard,
  chatReviewGuard,
  createTurnInputGuard,
  type ChatScope,
  chatComposerGuard,
  chatMessageCursorGuard,
  chatMessageGuard,
  chatSearchGuard,
  chatSessionCursorGuard,
  chatSessionErrorGuard,
  chatSessionGuard,
  createSessionInputGuard,
  sessionPageGuard,
  updateComposerInputGuard,
  updateSessionInputGuard,
} from '@logto/schemas';
import { z } from 'zod/v3';

import { EnvSet } from '#src/env-set/index.js';
import koaGuard from '#src/middleware/koa-guard.js';

import { getLandingPageAiToken } from './ai-chat-landing-page-auth.js';
import { runChatCompletion } from './ai-chat-runner.js';
import { createSessionActionStore } from './ai-chat-session-actions.js';
import { createTurnProposalStore } from './ai-chat-session-proposals.js';
import { respondSession as respond } from './ai-chat-session-response.js';
import { ChatSessionStoreError, createChatSessionStore } from './ai-chat-session-store.js';
import { createChatTurnStore } from './ai-chat-session-turn-store.js';
import { runSessionTurn } from './ai-chat-session-turns.js';
import { requireChatUser } from './ai-chat-user.js';
import {
  type ManagementApiRouter,
  type ManagementApiRouterContext,
  type RouterInitArgs,
} from './types.js';

const params = z.object({ id: z.string().min(1) });
const status = [200, 404, 409, 413];

export default function aiChatSessionRoutes<T extends ManagementApiRouter>(
  ...[router, tenant]: RouterInitArgs<T>
) {
  router.use('/ai-chat/sessions', requireChatUser);
  const store = createChatSessionStore(tenant.envSet.pool);
  const scope = (ctx: ManagementApiRouterContext): ChatScope => ({
    tenantId: tenant.id,
    userId: ctx.auth.id,
  });
  const sessionResponse = z.union([chatSessionGuard, chatSessionErrorGuard]);
  const composerResponse = z.union([chatComposerGuard, chatSessionErrorGuard]);
  const turns = createChatTurnStore(tenant.envSet.pool);
  const turnResponse = z.union([chatTurnGuard, chatSessionErrorGuard]);
  const reviews = createSessionActionStore(tenant.envSet.pool);
  router.get(
    '/ai-chat/sessions/:id/reviews',
    koaGuard({
      params,
      response: z.union([chatReviewGuard.array(), chatSessionErrorGuard]),
      status: [200, 404],
    }),
    async (ctx, next) => {
      await respond(ctx, async () => reviews.getSessionReviews(scope(ctx), ctx.guard.params.id));
      return next();
    }
  );
  router.post(
    '/ai-chat/sessions/:id/reviews/:originalActionId/refresh',
    koaGuard({
      params: params.extend({ originalActionId: z.string().min(1) }),
      body: z.object({ expectedActionId: z.string().min(1) }).strict(),
      response: z.union([chatReviewGuard, chatSessionErrorGuard]),
      status,
    }),
    async (ctx, next) => {
      await respond(ctx, async () =>
        reviews.refreshSessionReview(
          scope(ctx),
          ctx.guard.params.id,
          ctx.guard.params.originalActionId,
          ctx.guard.body.expectedActionId
        )
      );
      return next();
    }
  );

  router.post(
    '/ai-chat/sessions/:id/turns',
    koaGuard({
      params,
      body: createTurnInputGuard,
      response: turnResponse,
      status: [200, 404, 409, 413, 503],
    }),
    async (ctx, next) => {
      await respond(ctx, async () => {
        const apiKey = process.env.OPENAI_API_KEY ?? '';
        if (!apiKey) {
          throw new ChatSessionStoreError('ai_chat_not_configured');
        }
        const token = (() => {
          try {
            return extractBearerToken(ctx.get('authorization'));
          } catch {}
        })();
        const owner = scope(ctx);
        const sessionId = ctx.guard.params.id;
        return runSessionTurn({
          scope: owner,
          sessionId,
          input: ctx.guard.body,
          credentials: { apiKey },
          store: {
            sessions: store,
            turns,
            propose: (turnId, leaseToken) =>
              createTurnProposalStore(tenant.envSet.pool, owner, sessionId, turnId, leaseToken),
          },
          runner: async (options) =>
            runChatCompletion({
              ...options,
              credentials: {
                apiKey,
                token,
                userId: owner.userId,
                tenantId: owner.tenantId,
                apiBase: `${tenant.envSet.endpoint.origin}/api`,
                landingPageApiBase: `${EnvSet.values.cloudUrlSet.endpoint.origin}/api`,
                getEditorToken: async () =>
                  getLandingPageAiToken(
                    tenant.envSet,
                    ctx.get('x-landing-page-authorization'),
                    owner.userId
                  ),
              },
            }),
        });
      });
      return next();
    }
  );
  router.get(
    '/ai-chat/sessions/:id/turns',
    koaGuard({
      params,
      response: z.union([z.object({ turn: chatTurnGuard.nullable() }), chatSessionErrorGuard]),
      status: [200, 404],
    }),
    async (ctx, next) => {
      await respond(ctx, async () => {
        if (!(await store.get(scope(ctx), ctx.guard.params.id))) {
          throw new ChatSessionStoreError('not_found');
        }
        return { turn: (await turns.get(scope(ctx), ctx.guard.params.id)) ?? null };
      });
      return next();
    }
  );
  router.get(
    '/ai-chat/sessions/:id/turns/:requestId',
    koaGuard({
      params: params.extend({ requestId: z.string().uuid() }),
      response: turnResponse,
      status: [200, 404],
    }),
    async (ctx, next) => {
      await respond(ctx, async () => {
        const turn = await turns.get(scope(ctx), ctx.guard.params.id, ctx.guard.params.requestId);
        if (!turn) {
          throw new ChatSessionStoreError('not_found');
        }
        return turn;
      });
      return next();
    }
  );

  router.post(
    '/ai-chat/sessions',
    koaGuard({
      body: createSessionInputGuard,
      response: sessionResponse,
      status: [201, 413],
    }),
    async (ctx, next) => {
      await respond(ctx, async () => store.create(scope(ctx), ctx.guard.body.requestId), 201);
      return next();
    }
  );
  router.get(
    '/ai-chat/sessions',
    koaGuard({
      query: z
        .object({
          archived: z
            .enum(['true', 'false'])
            .optional()
            .default('false')
            .transform((value) => value === 'true'),
          search: chatSearchGuard.optional(),
          cursor: chatSessionCursorGuard.optional(),
        })
        .strict(),
      response: sessionPageGuard(chatSessionGuard),
      status: [200],
    }),
    async (ctx, next) => {
      ctx.body = await store.list(scope(ctx), ctx.guard.query);
      return next();
    }
  );
  router.get(
    '/ai-chat/sessions/:id',
    koaGuard({ params, response: sessionResponse, status: [200, 404] }),
    async (ctx, next) => {
      await respond(ctx, async () => {
        const session = await store.get(scope(ctx), ctx.guard.params.id);
        if (!session) {
          throw new ChatSessionStoreError('not_found');
        }
        return session;
      });
      return next();
    }
  );
  router.patch(
    '/ai-chat/sessions/:id',
    koaGuard({
      params,
      body: updateSessionInputGuard,
      response: sessionResponse,
      status: [200, 404, 409],
    }),
    async (ctx, next) => {
      await respond(ctx, async () => store.update(scope(ctx), ctx.guard.params.id, ctx.guard.body));
      return next();
    }
  );
  router.delete(
    '/ai-chat/sessions/:id',
    koaGuard({
      params,
      query: z
        .object({
          expectedRevision: z
            .string()
            .regex(/^(0|[1-9]\d*)$/u)
            .transform(Number)
            .pipe(z.number().int().nonnegative().safe()),
        })
        .strict(),
      response: chatSessionErrorGuard.optional(),
      status: [204, 404, 409],
    }),
    async (ctx, next) => {
      await respond(
        ctx,
        async () => store.remove(scope(ctx), ctx.guard.params.id, ctx.guard.query.expectedRevision),
        204
      );
      return next();
    }
  );
  router.get(
    '/ai-chat/sessions/:id/messages',
    koaGuard({
      params,
      query: z.object({ cursor: chatMessageCursorGuard.optional() }).strict(),
      response: z.union([sessionPageGuard(chatMessageGuard), chatSessionErrorGuard]),
      status: [200, 404],
    }),
    async (ctx, next) => {
      await respond(ctx, async () => {
        if (!(await store.get(scope(ctx), ctx.guard.params.id))) {
          throw new ChatSessionStoreError('not_found');
        }
        return store.messages(scope(ctx), ctx.guard.params.id, ctx.guard.query.cursor);
      });
      return next();
    }
  );
  router.get(
    '/ai-chat/sessions/:id/composer',
    koaGuard({ params, response: composerResponse, status: [200, 404] }),
    async (ctx, next) => {
      await respond(ctx, async () => store.getComposer(scope(ctx), ctx.guard.params.id));
      return next();
    }
  );
  router.put(
    '/ai-chat/sessions/:id/composer',
    koaGuard({ params, body: updateComposerInputGuard, response: composerResponse, status }),
    async (ctx, next) => {
      await respond(ctx, async () =>
        store.saveComposer(scope(ctx), ctx.guard.params.id, ctx.guard.body)
      );
      return next();
    }
  );
}

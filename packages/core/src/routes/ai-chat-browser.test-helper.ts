import { createServer, type IncomingMessage } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

import {
  createSessionInputGuard,
  updateSessionInputGuard,
  updateComposerInputGuard,
  createTurnInputGuard,
  type ChatScope,
} from '@logto/schemas';

import { proposePendingAction, confirmPendingAction } from './ai-chat-actions.js';
import { createBrowserDatabase } from './ai-chat-browser-database.test-helper.js';
import { createSessionActionStore } from './ai-chat-session-actions.js';
import { createTurnProposalStore } from './ai-chat-session-proposals.js';
import { createChatSessionStore, ChatSessionStoreError } from './ai-chat-session-store.js';
import { createChatTurnStore } from './ai-chat-session-turn-store.js';
import { runSessionTurn } from './ai-chat-session-turns.js';

const readBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks = new Map<number, Uint8Array>();
  for await (const chunk of request) {
    const value: unknown = chunk;
    if (!Buffer.isBuffer(value)) {
      throw new TypeError('Unexpected request chunk');
    }
    chunks.set(chunks.size, value);
    if ([...chunks.values()].reduce((total, item) => total + item.byteLength, 0) > 1024 * 1024) {
      throw new Error('Fixture payload limit');
    }
  }
  const result: unknown = JSON.parse(Buffer.concat([...chunks.values()]).toString('utf8'));
  return result;
};
type FixtureRequest = {
  request: IncomingMessage;
  query: URLSearchParams;
  scope: ChatScope;
  id: string;
  requestId?: string;
};
type FixtureResponse = { status: number; body?: unknown };

/** Test-only HTTP/auth/model boundary over real persistence, turns and review services. */
export async function startChatBrowserFixture(databaseUrl: string) {
  const database = await createBrowserDatabase(databaseUrl);
  const { pool } = database;
  const sessions = createChatSessionStore(pool);
  const turns = createChatTurnStore(pool);
  const reviews = createSessionActionStore(pool);
  const run = async ({ scope, id, request }: FixtureRequest) => {
    const input = createTurnInputGuard.parse(await readBody(request));
    return runSessionTurn({
      scope,
      sessionId: id,
      input,
      credentials: { apiKey: 'synthetic-not-a-key' },
      store: {
        sessions,
        turns,
        propose: (turnId, token) => createTurnProposalStore(pool, scope, id, turnId, token),
      },
      runner: async ({ propose, assertActive }) => {
        await delay(800);
        await assertActive();
        if (input.text.includes('review')) {
          await proposePendingAction({
            store: propose,
            tool: 'create_organization',
            args: { name: 'Synthetic organization' },
            ...scope,
            now: new Date(),
          });
        }
        return { ok: true, content: `Synthetic reply: ${input.text}` };
      },
    });
  };
  const routes: Record<string, (context: FixtureRequest) => Promise<FixtureResponse>> = {
    'POST sessions': async ({ scope, request }) => ({
      status: 201,
      body: await sessions.create(
        scope,
        createSessionInputGuard.parse(await readBody(request)).requestId
      ),
    }),
    'GET sessions': async ({ scope, query }) => ({
      status: 200,
      body: await sessions.list(scope, {
        archived: query.get('archived') === 'true',
        search: query.get('search') ?? '',
        cursor: query.get('cursor') ?? undefined,
      }),
    }),
    'GET sessions/:id': async ({ scope, id }) => ({
      status: 200,
      body: await sessions.get(scope, id),
    }),
    'PATCH sessions/:id': async ({ scope, id, request }) => ({
      status: 200,
      body: await sessions.update(
        scope,
        id,
        updateSessionInputGuard.parse(await readBody(request))
      ),
    }),
    'DELETE sessions/:id': async ({ scope, id, query }) => {
      await sessions.remove(scope, id, Number(query.get('expectedRevision')));
      return { status: 204 };
    },
    'GET sessions/:id/composer': async ({ scope, id }) => ({
      status: 200,
      body: await sessions.getComposer(scope, id),
    }),
    'PUT sessions/:id/composer': async ({ scope, id, request }) => ({
      status: 200,
      body: await sessions.saveComposer(
        scope,
        id,
        updateComposerInputGuard.parse(await readBody(request))
      ),
    }),
    'GET sessions/:id/messages': async ({ scope, id, query }) => ({
      status: 200,
      body: await sessions.messages(scope, id, query.get('cursor') ?? undefined),
    }),
    'GET sessions/:id/reviews': async ({ scope, id }) => ({
      status: 200,
      body: await reviews.getSessionReviews(scope, id),
    }),
    'GET sessions/:id/turns': async ({ scope, id }) => ({
      status: 200,
      body: { turn: (await turns.get(scope, id)) ?? null },
    }),
    'GET sessions/:id/turns/:requestId': async ({ scope, id, requestId }) => ({
      status: 200,
      body: (await turns.get(scope, id, requestId)) ?? null,
    }),
    'POST sessions/:id/turns': async (context) => ({ status: 200, body: await run(context) }),
    'POST actions/:id/confirm': async ({ scope, id }) => ({
      status: 200,
      body: await reviews.withSessionActionOperation(
        scope,
        id,
        { kind: 'confirm' },
        async (store) =>
          confirmPendingAction({
            store,
            id,
            ...scope,
            now: new Date(),
            execute: async () => ({ content: [] }),
          })
      ),
    }),
  };
  const dispatch = async (request: IncomingMessage): Promise<FixtureResponse> => {
    const owner = request.headers['x-test-owner'];
    if (typeof owner !== 'string' || !/^[\w-]{1,80}$/u.test(owner)) {
      return { status: 401 };
    }
    const scope: ChatScope = { tenantId: 'tenant-a', userId: owner };
    const parsed = new URL(request.url ?? '/', 'http://127.0.0.1');
    const [, chat, resource, id = '', child, requestId] = parsed.pathname
      .split('/')
      .filter(Boolean);
    if (chat !== 'ai-chat') {
      return { status: 404 };
    }
    if (resource === 'sessions' && id && !(await sessions.get(scope, id))) {
      throw new ChatSessionStoreError('not_found');
    }
    const key = `${request.method} ${[resource, id ? ':id' : undefined, child, requestId ? ':requestId' : undefined].filter(Boolean).join('/')}`;
    const route = routes[key];
    return route
      ? route({ request, scope, id, requestId, query: parsed.searchParams })
      : { status: 404 };
  };
  const server = createServer((request, response) => {
    void (async () => {
      try {
        const result = await dispatch(request);
        response.writeHead(result.status, { 'content-type': 'application/json' });
        response.end(result.body === undefined ? undefined : JSON.stringify(result.body));
      } catch (error) {
        const code = error instanceof ChatSessionStoreError ? error.code : 'ai_chat_unavailable';
        response.writeHead(code === 'not_found' ? 404 : code === 'content_limit' ? 413 : 409, {
          'content-type': 'application/json',
        });
        response.end(JSON.stringify({ error: code }));
      }
    })();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Missing fixture port');
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
      await database.close();
    },
  };
}

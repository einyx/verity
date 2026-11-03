import { type PendingAction } from './ai-chat-actions.js';
import type { ChatSessionStore } from './ai-chat-session-store.js';
import type { ChatTurnStore } from './ai-chat-session-turn-store.js';
import { runSessionTurn } from './ai-chat-session-turns.js';

const { jest } = import.meta;
const post = jest.fn();
const download = jest.fn();
const cancel = jest.fn();
jest.unstable_mockModule('got', () => ({
  got: {
    // eslint-disable-next-line @typescript-eslint/promise-function-async -- Got returns an augmented promise; async would discard .on/.cancel.
    post: (...args: unknown[]) =>
      // eslint-disable-next-line @silverhand/fp/no-mutating-assign -- Synthetic Got request with its public event/cancellation interface.
      Object.assign(post(...args) as Promise<unknown>, { on: download, cancel }),
  },
  HTTPError: class extends Error {},
}));
jest.unstable_mockModule('#src/env-set/index.js', () => ({
  EnvSet: { values: { isDevFeaturesEnabled: true } },
}));
const { runChatCompletion } = await import('./ai-chat-runner.js');
const { ChatSessionStoreError } = await import('./ai-chat-session-operation.js');
const credentials = {
  apiKey: 'test-key',
  token: 'caller-token',
  apiBase: 'https://tenant.example/api',
  landingPageApiBase: 'https://cloud.example/api',
  getEditorToken: async () => 'editor-token',
  tenantId: 'tenant',
  userId: 'user',
};
// eslint-disable-next-line @typescript-eslint/ban-types -- OpenAI's wire format uses null for tool-only replies.
const reply = (content: string | null, calls?: string[]) => ({
  body: {
    choices: [
      {
        message: {
          content,
          ...(calls
            ? {
                tool_calls: calls.map((name, index) => ({
                  id: `call-${index}`,
                  function: {
                    name,
                    arguments: '{"name":"Example"}',
                  },
                })),
              }
            : {}),
        },
      },
    ],
  },
});
const options = () => ({
  messages: [{ role: 'user' as const, content: 'hello' }],
  credentials,
  propose: {
    insert: async (_action: PendingAction) => {
      /* No persistence in runner-only tests. */
    },
  },
  assertActive: async () => {
    /* Active lease. */
  },
});
beforeEach(() => {
  post.mockReset();
  download.mockReset();
  cancel.mockReset();
});

it('cancels an oversized model response on decompressed download progress', async () => {
  const pending = new Promise((_resolve, reject) => {
    cancel.mockImplementation(() => {
      reject(new Error('Cancelled oversized reply'));
    });
  });
  post.mockReturnValue(pending);
  download.mockImplementation(
    (_event: string, listener: (progress: { transferred: number }) => void) => {
      listener({ transferred: 1_000_001 });
    }
  );
  expect(await runChatCompletion(options())).toMatchObject({ ok: false });
  expect(cancel).toHaveBeenCalledTimes(1);
});
afterEach(() => {
  jest.restoreAllMocks();
});

it('legacy_completion_keeps_existing_contract', async () => {
  post.mockResolvedValue(reply('answer'));
  expect(await runChatCompletion(options())).toEqual({ ok: true, content: 'answer', actions: [] });
  expect(post.mock.calls[0]?.[1]).toMatchObject({
    timeout: { request: 60_000 },
    json: { model: 'gpt-4.1' },
  });
});

it('never invokes a model or inserts proposals for a read-only landing request on the chat route', async () => {
  post.mockResolvedValue(reply('answer'));
  const insert = jest.fn();
  const result = await runChatCompletion({
    ...options(),
    messages: [{ role: 'user', content: 'Review the landing page and suggest an improvement for me to preview. Do not save or publish anything.' }],
    propose: { insert },
  });
  expect(result).toMatchObject({ ok: true, actions: [] });
  expect(post).not.toHaveBeenCalled();
  expect(insert).not.toHaveBeenCalled();
});

it('does not advertise landing editing when the verified editor credential is unavailable', async () => {
  post.mockResolvedValue(reply('answer'));
  await runChatCompletion({ ...options(), credentials: { ...credentials, getEditorToken: async () => { throw new Error('unavailable'); } } });
  const request = post.mock.calls[0]?.[1] as { json: { tools: Array<{ function: { name: string } }> } };
  expect(request.json.tools.some((tool) => tool.function.name === 'edit_landing_page')).toBe(false);
});

it.each(['legacy', 'persistent'] as const)(
  '%s model→tool→model loop excludes credentials and sensitive user/log fields',
  async (path) => {
    const secret = 'SENTINEL_NEVER_SEND_TO_MODEL';
    const body = {
      id: 'safe-id',
      name: 'Safe name',
      type: 'Social',
      createdAt: 123,
      config: { accessKey: secret },
      secret,
      passwordEncrypted: secret,
      customData: { credential: secret },
      identities: { provider: { token: secret } },
      payload: { token: secret, headers: { authorization: secret } },
    };
    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(JSON.stringify([body])));
    post
      .mockResolvedValueOnce(
        reply(null, ['list_connectors', 'list_applications', 'list_users', 'get_audit_logs'])
      )
      .mockResolvedValueOnce(reply('Safe answer'));
    if (path === 'legacy') {
      expect(await runChatCompletion(options())).toMatchObject({
        ok: true,
        content: 'Safe answer',
      });
    } else {
      const turn = {
        id: 'turn',
        requestId: '10000000-0000-4000-8000-000000000000',
        state: 'running' as const,
        errorCode: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        completedAt: null,
        messageIds: [],
      };
      const turns = {
        claim: async () => ({ kind: 'claimed', turn, leaseToken: 'lease' }),
        assertOwned: async () => {
          /* Synthetic active lease; no database. */
        },
        heartbeat: async () => {
          /* Synthetic active lease; no database. */
        },
        complete: async () => ({ ...turn, state: 'completed' }),
        fail: jest.fn(),
      } as unknown as ChatTurnStore;
      const sessions = {
        messages: async () => ({ items: [{ role: 'user', content: 'hello' }], nextCursor: null }),
      } as unknown as ChatSessionStore;
      const result = await runSessionTurn({
        scope: { tenantId: 'tenant', userId: 'user' },
        sessionId: 'session',
        input: {
          requestId: turn.requestId,
          expectedTranscriptRevision: 0,
          composerRevision: 0,
          text: 'hello',
          attachments: [],
        },
        credentials: { apiKey: credentials.apiKey },
        store: { turns, sessions, propose: () => options().propose },
        runner: async (input) => runChatCompletion({ ...input, credentials }),
      });
      expect(result.state).toBe('completed');
    }
    expect(post).toHaveBeenCalledTimes(2);
    const secondRequest = JSON.stringify(post.mock.calls[1]?.[1]);
    expect(secondRequest).toContain('safe-id');
    expect(secondRequest).not.toContain(secret);
  }
);
it('lost_lease_after_model_blocks_next_tool_and_result', async () => {
  const lost = new AbortController();
  post.mockImplementation(async () => {
    lost.abort();
    return reply(null, ['create_organization']);
  });
  const inserts = new Set<PendingAction>();
  await expect(
    runChatCompletion({
      ...options(),
      assertActive: async () => {
        if (lost.signal.aborted) {
          throw new ChatSessionStoreError('session_busy');
        }
      },
      propose: {
        insert: async (action) => {
          inserts.add(action);
        },
      },
    })
  ).rejects.toMatchObject({ code: 'session_busy' });
  expect(inserts.size).toBe(0);
  expect(post).toHaveBeenCalledTimes(1);
});
it('lost_lease_after_read_blocks_second_tool_and_next_model', async () => {
  const lost = new AbortController();
  post.mockResolvedValue(reply(null, ['list_users', 'create_organization']));
  const network = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    lost.abort();
    return new Response('[]', { status: 200 });
  });
  const inserts = new Set<PendingAction>();
  await expect(
    runChatCompletion({
      ...options(),
      assertActive: async () => {
        if (lost.signal.aborted) {
          throw new ChatSessionStoreError('session_busy');
        }
      },
      propose: {
        insert: async (action) => {
          inserts.add(action);
        },
      },
    })
  ).rejects.toMatchObject({ code: 'session_busy' });
  expect(network).toHaveBeenCalledTimes(1);
  expect(inserts.size).toBe(0);
  expect(post).toHaveBeenCalledTimes(1);
});
it('writes_only_propose_and_remain_limited_to_three_per_request', async () => {
  post
    .mockResolvedValueOnce(
      reply(
        null,
        Array.from({ length: 4 }, () => 'create_organization')
      )
    )
    .mockResolvedValueOnce(reply('Review the proposals'));
  const inserts = new Set<PendingAction>();
  const network = jest.spyOn(globalThis, 'fetch');
  const result = await runChatCompletion({
    ...options(),
    propose: {
      insert: async (action) => {
        inserts.add(action);
      },
    },
  });
  expect(result.actions).toHaveLength(3);
  expect([...inserts].map(({ body }) => body)).toEqual(
    Array.from({ length: 3 }, () => ({ name: 'Example', description: undefined }))
  );
  expect(network).not.toHaveBeenCalled();
});

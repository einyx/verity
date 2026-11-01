import type { Hook } from '@logto/schemas';
import { ConsoleLog } from '@logto/shared';
import { createMockUtils } from '@logto/shared/esm';

import { mockUser } from '#src/__mocks__/user.js';

const { jest } = import.meta;
const { mockEsm, mockEsmWithActual } = createMockUtils(jest);
const requestBodies = jest.fn();
const reply = jest.fn(async () => new Response('ok'));
const fetch = jest.fn(async (request: Request) => {
  requestBodies(await request.clone().json());
  return reply();
});
const sign = jest.fn(() => 'test-signature');
await mockEsmWithActual('#src/utils/outbound-request.js', () => ({ ssrfProtectedFetch: fetch }));
mockEsm('#src/utils/sign.js', () => ({ sign }));

const { sendWebhookRequest, generateHookTestPayload } = await import('./utils.js');
const { createHookLibrary } = await import('./index.js');
const { HookContextManager } = await import('./context-manager.js');
const { MockQueries } = await import('#src/test-utils/tenant.js');

const url = 'https://hooks.slack.com/services/T_TEST/B_TEST/TEST_ONLY_SECRET';
const payload = {
  ...generateHookTestPayload('test-hook', 'User.Data.Updated'),
  createdAt: '2026-11-01T00:00:00.000Z',
  sessionId: 'PRIVATE_SESSION',
  data: { primaryEmail: 'private@example.com', name: '<!channel>', customData: { secret: 'x' } },
};
const body = { text: 'User.Data.Updated at 2026-11-01T00:00:00.000Z' };
const hook: Hook = {
  tenantId: 'tenant',
  id: 'test-hook',
  name: '<!everyone>',
  event: 'User.Data.Updated',
  events: ['User.Data.Updated'],
  signingKey: 'test-key',
  enabled: true,
  config: { url, retries: 0 },
  createdAt: 0,
};
const insertLog = jest.fn();
const library = createHookLibrary(
  new MockQueries({
    hooks: {
      findAllHooks: jest.fn().mockResolvedValue([hook]),
      findHookById: jest.fn().mockResolvedValue(hook),
    },
    logs: { insertLog },
  })
);

afterEach(() => {
  jest.clearAllMocks();
});

it('sends and signs only event and timestamp for Slack', async () => {
  await sendWebhookRequest({ hookConfig: { url }, payload, signingKey: 'test-key' });
  const request = fetch.mock.lastCall?.[0];
  expect(requestBodies).toHaveBeenLastCalledWith(body);
  expect(sign).toHaveBeenLastCalledWith('test-key', body);
  expect(request?.headers.get('logto-signature-sha-256')).toBe('test-signature');
});

it.each([
  'https://example.com/services/T/B/S',
  'https://hooks.slack.com.evil.example/services/T/B/S',
  'https://hooks.slack.com@evil.example/services/T/B/S',
  'https://user:password@hooks.slack.com/services/T/B/S',
  'http://hooks.slack.com/services/T/B/S',
  'https://hooks.slack.com:444/services/T/B/S',
  'https://hooks.slack.com/services/T/B',
  'https://hooks.slack.com/services/T/B/S/extra',
  'https://hooks.slack.com/workflows/T/B/S',
  'https://hooks.slack.com/services/T/B/S?extra=1',
  'https://hooks.slack.com/services/T/B/S#extra',
])('keeps generic body and signature unchanged for %s', async (endpoint) => {
  // Credential URLs are rejected by Request before fetch; inspect the deterministic signer instead.
  await sendWebhookRequest({
    hookConfig: { url: endpoint },
    payload,
    signingKey: 'test-key',
  }).catch((error: unknown) => {
    expect(error).toHaveProperty('name', 'TypeError');
  });
  expect(sign).toHaveBeenLastCalledWith('test-key', payload);
  if (fetch.mock.lastCall) {
    expect(requestBodies).toHaveBeenLastCalledWith(payload);
  }
});

it('formats triggerTestHook through the same sender', async () => {
  await library.triggerTestHook(hook.id, hook.events, hook.config);
  expect(requestBodies).toHaveBeenLastCalledWith({
    text: expect.stringMatching(/^User\.Data\.Updated at /) as unknown,
  });
});

it('logs the transmitted Slack body and safe 400 diagnostics without retrying', async () => {
  reply.mockResolvedValueOnce(
    new Response('missing_text_or_fallback_or_attachments', { status: 400 })
  );
  const context = new HookContextManager({
    ip: 'PRIVATE_IP',
    sessionId: 'PRIVATE_SESSION',
    userAgent: 'PRIVATE_AGENT',
  });
  context.appendDataHookContext('User.Data.Updated', { user: mockUser, data: payload.data });
  await library.triggerDataHooks(new ConsoleLog(), context);
  expect(fetch).toHaveBeenCalledTimes(1);
  const logged: unknown = insertLog.mock.lastCall?.[0];
  expect(logged).toMatchObject({
    payload: {
      hookRequest: { body: { text: expect.stringMatching(/^User\.Data\.Updated at /) as unknown } },
      response: { statusCode: 400, body: 'missing_text_or_fallback_or_attachments' },
      error: 'HTTPError (400)',
    },
  });
  expect(logged).toHaveProperty('payload.hookRequest.body', requestBodies.mock.lastCall?.[0]);
  expect(JSON.stringify(logged)).not.toMatch(
    /TEST_ONLY_SECRET|private@example.com|PRIVATE_SESSION|PRIVATE_AGENT|<!channel>/
  );
});

it('does not echo a secret-bearing nonHTTP failure in the test route', async () => {
  reply.mockRejectedValueOnce(new Error(`Failed ${url}`));
  await expect(library.triggerTestHook(hook.id, hook.events, hook.config)).rejects.toThrow(
    'Failed to send test payload: Error'
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('redacts echoed secrets in Slack test-route HTTP diagnostics', async () => {
  reply.mockResolvedValueOnce(
    new Response(`invalid_token ${url} TEST_ONLY_SECRET`, { status: 400 })
  );
  await expect(library.triggerTestHook(hook.id, hook.events, hook.config)).rejects.toMatchObject({
    data: { responseStatus: 400, responseBody: 'invalid_token [Slack webhook] [redacted]' },
  });
});

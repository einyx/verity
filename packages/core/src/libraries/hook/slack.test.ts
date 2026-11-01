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
const { buildWebhookRequestBody } = await import('./slack-payload.js');
const { MockQueries } = await import('#src/test-utils/tenant.js');

const url = 'https://hooks.slack.com/services/T_TEST/B_TEST/TEST_ONLY_SECRET';
const payload = {
  ...generateHookTestPayload('test-hook', 'User.Data.Updated'),
  createdAt: '2026-11-01T00:00:00.000Z',
  sessionId: 'PRIVATE_SESSION',
  data: { primaryEmail: 'private@example.com', name: '<!channel>', customData: { secret: 'x' } },
};
const body = buildWebhookRequestBody(url, payload);
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

it.each([
  ['/users/:userId/custom-data', { name: 'PRIVATE_CUSTOMER_CREDENTIAL' }],
  [
    '/users/:userId/custom-data',
    {
      ...mockUser,
      id: 'PRIVATE_SPOOFED_ID',
      name: 'PRIVATE_SPOOFED_NAME',
      username: 'PRIVATE_SPOOFED_USERNAME',
    },
  ],
  [
    '/users/:userId/profile',
    {
      givenName: 'PRIVATE_GIVEN_NAME',
      familyName: 'PRIVATE_FAMILY_NAME',
      preferredUsername: 'PRIVATE_PREFERRED_USERNAME',
      address: { streetAddress: 'PRIVATE_ADDRESS' },
    },
  ],
])('keeps raw %s response data out of Slack sending/signing/audit', async (matchedRoute, data) => {
  const context = new HookContextManager({ ip: 'PRIVATE_IP' });
  const registration = context.getRegisteredHookEventContext({
    method: 'PATCH',
    _matchedRoute: matchedRoute,
    path: matchedRoute.replace(':userId', 'verified-route-user'),
    params: { userId: 'verified-route-user' },
    status: 200,
    response: { body: data },
  } as unknown as Parameters<typeof context.getRegisteredHookEventContext>[0]);
  expect(registration).toBeDefined();
  if (!registration) {
    throw new Error('Expected registered user subresource producer');
  }
  context.appendDataHookContext(registration[0], registration[1]);
  await library.triggerDataHooks(new ConsoleLog(), context);
  const sent: unknown = requestBodies.mock.lastCall?.[0];
  expect(sent).toMatchObject({
    text: expect.stringContaining('Affected user: verified-route-user') as unknown,
  });
  expect(JSON.stringify(sent)).not.toContain('PRIVATE_');
  expect(sign).toHaveBeenLastCalledWith('test-key', sent);
  expect(insertLog.mock.lastCall?.[0]).toHaveProperty('payload.hookRequest.body', sent);
  expect(JSON.stringify(insertLog.mock.lastCall?.[0])).not.toContain('PRIVATE_');

  // Generic event data must still be sent/signed intact, including custom-data responses.
  const genericPayload = {
    ...generateHookTestPayload(hook.id, 'User.Data.Updated'),
    ...registration[1],
  };
  await sendWebhookRequest({
    hookConfig: { url: 'https://example.com' },
    payload: genericPayload,
    signingKey: 'test-key',
  });
  expect(requestBodies).toHaveBeenLastCalledWith(genericPayload);
  expect(sign).toHaveBeenLastCalledWith('test-key', genericPayload);
});

it('sends and signs the readable minimal-context Slack body', async () => {
  await sendWebhookRequest({ hookConfig: { url }, payload, signingKey: 'test-key' });
  const request = fetch.mock.lastCall?.[0];
  expect(requestBodies).toHaveBeenLastCalledWith(body);
  expect(sign).toHaveBeenLastCalledWith('test-key', body);
  expect(request?.headers.get('logto-signature-sha-256')).toBe('test-signature');
});

it('keeps the typed user subject readable in the sent, signed and audited body', async () => {
  const context = new HookContextManager({ ip: 'PRIVATE_IP' });
  context.appendDataHookContext('User.Data.Updated', {
    user: { ...mockUser, name: 'Typed subject', customData: { name: 'PRIVATE_CUSTOM_DATA' } },
  });
  await library.triggerDataHooks(new ConsoleLog(), context);
  const sent: unknown = requestBodies.mock.lastCall?.[0];
  expect(sent).toMatchObject({
    text: expect.stringContaining('Affected user: Typed subject') as unknown,
  });
  expect(JSON.stringify(sent)).not.toContain('PRIVATE_');
  expect(sign).toHaveBeenLastCalledWith('test-key', sent);
  expect(insertLog.mock.lastCall?.[0]).toHaveProperty('payload.hookRequest.body', sent);
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
  expect(requestBodies).toHaveBeenLastCalledWith(
    expect.objectContaining({
      text: expect.stringMatching(/^Test notification — User profile updated/) as unknown,
      blocks: expect.arrayContaining([expect.objectContaining({ type: 'header' })]) as unknown,
    })
  );
});

it('keeps generic manual test payloads unchanged', async () => {
  await library.triggerTestHook(hook.id, hook.events, { url: 'https://example.com' });
  expect(requestBodies).toHaveBeenLastCalledWith(
    expect.objectContaining({
      event: 'User.Data.Updated',
      hookId: hook.id,
    })
  );
  expect(requestBodies.mock.lastCall?.[0]).not.toHaveProperty('isTest');
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
      hookRequest: { body: { text: expect.stringMatching(/^User profile updated/) as unknown } },
      response: { statusCode: 400, body: 'missing_text_or_fallback_or_attachments' },
      error: 'HTTPError (400)',
    },
  });
  expect(logged).toHaveProperty('payload.hookRequest.body', requestBodies.mock.lastCall?.[0]);
  expect(JSON.stringify(logged)).not.toMatch(
    /TEST_ONLY_SECRET|private@example.com|PRIVATE_SESSION|PRIVATE_AGENT/
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

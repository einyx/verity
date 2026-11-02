import { hookEvents, type HookEventPayload } from '@logto/schemas';

import { mockUser } from '#src/__mocks__/user.js';

import { HookContextManager } from './context-manager.js';
import {
  buildWebhookRequestBody,
  isSlackWebhookUrl,
  redactSlackWebhookSecrets,
} from './slack-payload.js';
import { generateHookTestPayload } from './utils.js';

const url = 'https://hooks.slack.com/services/T_TEST/B_TEST/TEST_ONLY_SECRET';
const { jest } = import.meta;

const format = (input: Record<string, unknown>, isTest = false) =>
  buildWebhookRequestBody(url, input as HookEventPayload, { isTest });

const typedUserContext = () => {
  const context = new HookContextManager({ ip: 'not-sent' });
  context.appendDataHookContext('User.Data.Updated', { user: { ...mockUser, name: 'Affected' } });
  return context.dataHookContextArray[0];
};

const registeredContext = (method: string, matchedRoute: string, data: unknown) => {
  const context = new HookContextManager({ ip: 'not-sent' });
  const registration = context.getRegisteredHookEventContext({
    method,
    _matchedRoute: matchedRoute,
    response: { body: data },
    params: {},
  } as unknown as Parameters<typeof context.getRegisteredHookEventContext>[0]);
  if (!registration) {
    throw new Error('Expected registered producer');
  }
  return { ...registration[1], event: registration[0] };
};

describe('business Slack summaries', () => {
  const base = { createdAt: '2026-11-01T00:00:00.000Z' };

  it('shows the interaction user, real application and localized event time', () => {
    expect(
      format({
        ...base,
        event: 'PostSignIn',
        user: { name: 'Alessio' },
        application: { name: 'foundation-smoke-foundation' },
      })
    ).toMatchObject({
      text: expect.stringContaining(
        'User signed in\nUser: Alessio\nApplication: foundation-smoke-foundation'
      ) as unknown,
      blocks: expect.arrayContaining([
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: expect.stringMatching(
              /^When: <!date\^1793491200\^.*\|2026-11-01T00:00:00.000Z>$/
            ) as unknown,
          },
        },
      ]) as unknown,
    });
  });

  it.each([
    [
      'User.Data.Updated',
      { ...typedUserContext(), user: { name: 'Not the actor' } },
      'Affected user: Affected',
    ],
    [
      'Organization.Membership.Updated',
      { params: { id: 'org-id' }, user: { name: 'Not the actor' } },
      'Organization: org-id',
    ],
    [
      'OrganizationRole.Scopes.Updated',
      { params: { id: 'role-id' } },
      'Organization role: role-id',
    ],
    [
      'Scope.Deleted',
      { params: { resourceId: 'resource', scopeId: 'scope' } },
      'Permission: scope',
    ],
  ])('uses the affected entity for %s', (event, context, expected) => {
    const result = JSON.stringify(format({ ...base, event, ...context }));
    expect(result).toContain(expected);
    expect(result).not.toMatch(/Not the actor|By:/);
  });

  it('covers every event with a readable heading and labels only explicit tests', () => {
    for (const event of hookEvents) {
      const body = format({ ...base, event });
      expect(body).toHaveProperty('blocks.0.type', 'header');
      expect(body.text).not.toContain(event);
      expect(body.text).not.toContain('Test notification');
      expect(format({ ...base, event }, true).text).toContain('Test notification');
    }
    expect(format({ event: 'Future.Event' }).text).toContain('Event notification');
  });

  it.each([
    ['User.Data.Updated', { userId: 'user-id' }, 'Affected user: user-id'],
    ['Role.Scopes.Updated', { id: 'role-id' }, 'Role: role-id'],
    ['OrganizationRole.Scopes.Updated', { id: 'org-role-id' }, 'Organization role: org-role-id'],
  ])(
    'does not treat unknown or subresource data as the subject for %s',
    (event, params, expected) => {
      const body = format({
        event,
        params,
        data: { id: 'PRIVATE_ID', name: 'PRIVATE_NAME', username: 'PRIVATE_USERNAME' },
      });
      expect(body.text).toContain(expected);
      expect(JSON.stringify(body)).not.toContain('PRIVATE_');
    }
  );

  it('does not infer a subject from unprovenanced complete user-shaped data', () => {
    const body = format({
      event: 'User.Data.Updated',
      method: 'PATCH',
      matchedRoute: '/users/:userId',
      data: {
        id: 'PRIVATE_ID',
        name: 'PRIVATE_NAME',
        username: 'PRIVATE_USERNAME',
        isSuspended: false,
        customData: {},
        identities: {},
        profile: {},
      },
    });
    expect(body.text).toContain('Affected user: Not provided');
    expect(JSON.stringify(body)).not.toContain('PRIVATE_');
  });

  it.each([
    ['POST', '/users'],
    ['PATCH', '/users/:userId'],
    ['PATCH', '/users/:userId/password'],
    ['POST', '/roles'],
    ['PATCH', '/roles/:id'],
    ['POST', '/resources/:resourceId/scopes'],
    ['PATCH', '/resources/:resourceId/scopes/:scopeId'],
    ['POST', '/organizations'],
    ['PATCH', '/organizations/:id'],
    ['POST', '/organization-roles'],
    ['PATCH', '/organization-roles/:id'],
    ['POST', '/organization-scopes'],
    ['PATCH', '/organization-scopes/:id'],
  ])('uses entity identity from the registered %s %s producer', (method, route) => {
    expect(
      format(registeredContext(method, route, { id: 'entity-id', name: 'Entity display name' }))
        .text
    ).toContain('Entity display name');
  });

  it.each(['User.Created', 'User.Data.Updated', 'User.Deleted'])(
    'retains typed user producer identity for %s',
    (event) => {
      expect(format({ ...typedUserContext(), event }).text).toContain('Affected user: Affected');
    }
  );

  it.each(['PostSignIn', 'PostRegister'])(
    'retains the existing interaction user for %s',
    (event) => {
      expect(format({ event, user: { ...mockUser, name: 'Registered user' } }).text).toContain(
        'User: Registered user'
      );
    }
  );

  it.each([
    ['POST', '/roles/:id/scopes', [{ id: 'PRIVATE_SCOPE_ID', name: 'PRIVATE_PERMISSION_NAME' }]],
    [
      'PUT',
      '/organization-roles/:id/scopes',
      [{ id: 'PRIVATE_SCOPE_ID', name: 'PRIVATE_PERMISSION_NAME' }],
    ],
    ['DELETE', '/roles/:id/scopes/:scopeId', undefined],
    ['DELETE', '/organization-roles/:id/scopes/:organizationScopeId', undefined],
  ])('uses only parent role ID for registered %s %s subresource', (method, route, data) => {
    const context = registeredContext(method, route, data);
    const body = format({
      ...context,
      params: {
        id: 'parent-role-id',
        scopeId: 'PRIVATE_SCOPE_ID',
        organizationScopeId: 'PRIVATE_SCOPE_ID',
      },
    });
    expect(body.text).toContain('role-id');
    expect(JSON.stringify(body)).not.toContain('PRIVATE_');
  });

  it.each([
    [{ user: { username: 'username' } }, 'username'],
    [{ user: { id: 'user-id' } }, 'user-id'],
    [{ userId: 'fallback-id' }, 'fallback-id'],
  ])('uses only explicit interaction identity fallbacks: %p', (context, identity) => {
    expect(format({ ...base, event: 'PostSignIn', ...context }).text).toContain(
      `User: ${identity}`
    );
  });

  it('supports explicit data subject IDs and application IDs without exposing other context', () => {
    expect(
      format({ ...base, event: 'User.Data.Updated', userId: 'subject-id', applicationId: 'app-id' })
        .text
    ).toContain('Affected user: subject-id\nApplication: app-id');
    expect(
      format({
        ...base,
        event: 'User.Deleted',
        params: { userId: 'route-user' },
        user: { name: 'unrelated' },
      }).text
    ).toContain('Affected user: route-user');
    expect(
      format({
        ...base,
        event: 'Role.Created',
        data: { name: 'Admin' },
        application: { name: '<@U123> <!everyone> <https://evil.example|link>' },
      }).text
    ).toContain('Application: &lt;@U123&gt; &lt;!everyone&gt; &lt;https://evil.example|link&gt;');
  });

  it.each([undefined, null, {}, '', 'bad', Number.POSITIVE_INFINITY])(
    'handles malformed timestamps: %p',
    (createdAt) => {
      const body = JSON.stringify(format({ event: 'PostSignIn', createdAt, user: [] }));
      expect(body).toContain('Time unavailable');
      expect(body).not.toMatch(/NaN|Infinity|<!date/);
    }
  );

  it('allows only bounded plain-text context and escapes fallback mentions', () => {
    const body = format({
      ...base,
      event: 'PostSignIn',
      user: {
        name: `<!channel>\n${url} TEST_ONLY_SECRET${'x'.repeat(4000)}`,
        primaryEmail: 'PRIVATE_EMAIL',
        identities: { private: 'PRIVATE_IDENTITY' },
        customData: { secret: 'PRIVATE_SECRET' },
      },
      application: { name: {} },
      sessionId: 'PRIVATE_SESSION',
      userIp: 'PRIVATE_IP',
    });
    expect(body.text).toContain('&lt;!channel&gt;');
    expect(JSON.stringify(body)).not.toMatch(/TEST_ONLY_SECRET|PRIVATE_|hooks.slack.com/);
    expect(body).toHaveProperty('blocks.1.text.type', 'plain_text');
    expect(String(body.text).length).toBeLessThan(4000);
  });

  it('does not infer suspension direction or stringify malformed context', () => {
    expect(
      format({ event: 'Organization.Membership.Updated', organizationId: 'provisioned-org' }).text
    ).toContain('Organization: provisioned-org');
    expect(
      format({ event: 'User.SuspensionStatus.Updated', data: { isSuspended: 'false', name: {} } })
        .text
    ).toContain('User access status changed');
    expect(
      format(registeredContext('PATCH', '/users/:userId/is-suspended', { isSuspended: false })).text
    ).toContain('User access restored');
    expect(
      format(registeredContext('PATCH', '/users/:userId/is-suspended', { isSuspended: true })).text
    ).toContain('User suspended');
  });
});

const securityContextFixture = () => ({
  hookId: 'security-hook',
  event: 'PostSignIn',
  createdAt: '2026-11-01T23:26:45.785Z',
  userId: 'user-123',
  user: { id: 'user-123', name: 'Alice', primaryEmail: 'alice@example.com' },
  application: { id: 'app-123', name: 'Foundation' },
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 IP=203.0.113.23',
  userIp: '203.0.113.23',
  ip: '2001:db8::42',
  sessionId: 'PRIVATE_SESSION',
  accessToken: 'PRIVATE_TOKEN',
  data: { password: 'PRIVATE_PASSWORD' },
});

describe('opt-in security summaries', () => {
  beforeEach(() => {
    jest.replaceProperty(process, 'env', {
      ...process.env,
      NODE_ENV: 'production',
      DEV_FEATURES_ENABLED: '1',
      SLACK_SECURITY_NOTIFICATION_HOOK_IDS: ' security-hook, other-hook ',
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('adds email, stable IDs, event and parsed browser/OS without request secrets or IPs', () => {
    const body = format(securityContextFixture());
    const serialized = JSON.stringify(body);
    for (const expected of [
      'alice@example.com',
      'User ID: user-123',
      'Application ID: app-123',
      'Event: PostSignIn',
      'Webhook ID: security-hook',
      '2026-11-01T23:26:45.785Z',
    ]) {
      expect(serialized).toContain(expected);
    }
    expect(serialized).toMatch(/Chrome \/ (?:macOS|Mac OS)/);
    expect(serialized).not.toMatch(/203\.0\.113\.23|2001:db8::42|Mozilla|PRIVATE_/);
    expect(body).toMatchObject({ unfurl_links: false, unfurl_media: false });
  });

  it('does not opt in other hooks or wildcard/prefix matches', () => {
    for (const hookId of ['other-notification', 'security-hook-extra', '']) {
      expect(JSON.stringify(format({ ...securityContextFixture(), hookId }))).not.toContain(
        'alice@example.com'
      );
    }
    process.env.SLACK_SECURITY_NOTIFICATION_HOOK_IDS = '*';
    expect(JSON.stringify(format(securityContextFixture()))).not.toContain('alice@example.com');
  });

  it('does not expose security details when the development feature gate is disabled', () => {
    process.env.DEV_FEATURES_ENABLED = '0';
    expect(JSON.stringify(format(securityContextFixture()))).not.toContain('alice@example.com');
  });

  it('removes IP literals even when embedded in permitted display fields', () => {
    const serialized = JSON.stringify(
      format({
        ...securityContextFixture(),
        user: { name: 'Alice 203.0.113.23', primaryEmail: 'alice@example.com' },
        application: { name: 'Foundation [2001:db8::42] [::ffff:203.0.113.23] [fe80::1%en0]' },
      })
    );
    expect(serialized).toContain('Alice');
    expect(serialized).toContain('Foundation');
    expect(serialized).not.toMatch(/203\.0\.113\.23|2001:db8::42|::ffff|fe80::1/);
  });

  it('does not turn an affected entity into an actor or expose unprovenanced data', () => {
    const body = format({
      hookId: 'security-hook',
      event: 'User.Deleted',
      params: { userId: 'target-user' },
      user: { primaryEmail: 'PRIVATE_EMAIL' },
      data: { id: 'PRIVATE_ID', primaryEmail: 'PRIVATE_OTHER_EMAIL' },
    });
    expect(body.text).toContain('Affected user: target-user');
    expect(body.text).toContain('Actor: Not provided');
    expect(JSON.stringify(body)).not.toContain('PRIVATE_');
  });

  it.each([
    'Alice IP:2001:db8::42',
    'Foundation address:fe80::1%en0',
    'IPv6 address 2001:db8::42:',
    'Foundation IPv4:203.0.113.23',
  ])('redacts IP literals adjacent to punctuation: %s', (name) => {
    const result = JSON.stringify(
      format({
        ...securityContextFixture(),
        user: { name },
      })
    );
    expect(result).not.toMatch(/2001:db8::42|fe80::1|203\.0\.113\.23/);
  });

  it('keeps generic webhook bodies unchanged even for opted-in IDs', () => {
    // Deliberately partial event context exercises the receiver-boundary contract.
    const payload = securityContextFixture() as unknown as HookEventPayload;
    expect(buildWebhookRequestBody('https://example.com/webhook', payload)).toBe(payload);
  });

  it('retains bounded plain-text rendering and safe unknown-device fallbacks', () => {
    const body = format({
      ...securityContextFixture(),
      user: { id: 'user-123', primaryEmail: '<!channel>' + 'x'.repeat(5000) },
      userAgent: '203.0.113.23 PRIVATE_SESSION',
    });
    expect(String(body.text).length).toBeLessThan(4000);
    expect(body.text).not.toContain('<!channel>');
    expect(JSON.stringify(body)).not.toMatch(/203\.0\.113\.23|PRIVATE_SESSION/);
    expect(body).toHaveProperty('blocks.1.text.type', 'plain_text');
  });
});

describe('Slack endpoint boundary', () => {
  it.each([url, 'https://hooks.slack.com:443/services/T123/B456/aB09_-'])(
    'accepts a standard HTTPS endpoint: %s',
    (endpoint) => {
      expect(isSlackWebhookUrl(endpoint)).toBe(true);
    }
  );

  it.each([
    'not a URL',
    'https://hooks.slack.com./services/T/B/S',
    'https://hooks.slack.com/services//B/S',
    'https://hooks.slack.com/services/T/B/S/',
    'https://hooks.slack.com/services/T/B/S%2Fsecret',
    'https://hooks.slack.com/services/T/B/S%20secret',
  ])('leaves noncanonical endpoints untouched: %s', (endpoint) => {
    const payload = generateHookTestPayload('test-hook', 'User.Data.Updated');
    expect(isSlackWebhookUrl(endpoint)).toBe(false);
    expect(buildWebhookRequestBody(endpoint, payload)).toBe(payload);
  });

  it('redacts echoed URL and bearer secret while retaining response diagnostics', () => {
    expect(redactSlackWebhookSecrets(url, `invalid_token ${url} TEST_ONLY_SECRET`)).toBe(
      'invalid_token [Slack webhook] [redacted]'
    );
    expect(redactSlackWebhookSecrets('https://example.com', 'generic diagnostic')).toBe(
      'generic diagnostic'
    );
  });
});

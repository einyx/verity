import {
  buildLogtoToolUrl,
  callLogtoTool,
  enabledLogtoMcpTools,
  logtoMcpTools,
} from './mcp-logto-tools.js';

const { jest } = import.meta;

/**
 * Covers src/routes/mcp-logto-tools.ts. Requests are checked against a fetch stub, so nothing reaches
 * a real Management API, and the tests show that each call carries the caller's own token.
 */
const apiBase = 'https://auth.example.com/api';

const tool = (name: string) => {
  const found = logtoMcpTools.find((candidate) => candidate.name === name);

  if (!found) {
    throw new Error(`No tool ${name}`);
  }

  return found;
};

describe('buildLogtoToolUrl', () => {
  it('fills the path parameter', () => {
    const built = buildLogtoToolUrl(tool('get_application'), { id: 'app-1' }, apiBase);

    expect(built).toEqual({ url: new URL(`${apiBase}/applications/app-1`) });
  });

  it('passes paging as query parameters', () => {
    const built = buildLogtoToolUrl(tool('list_users'), { page: 2, page_size: 20 }, apiBase);

    expect('url' in built && built.url.searchParams.get('page')).toBe('2');
    expect('url' in built && built.url.searchParams.get('page_size')).toBe('20');
  });

  it('ignores paging values that are not positive integers', () => {
    const built = buildLogtoToolUrl(tool('list_users'), { page: -1, page_size: 1.5 }, apiBase);

    expect('url' in built && [...built.url.searchParams.keys()]).toEqual([]);
  });

  it('refuses a call without the id it needs, before any request is made', () => {
    expect(buildLogtoToolUrl(tool('get_user'), {}, apiBase)).toEqual({
      error: 'Missing argument: id',
    });
  });

  it('encodes an id so it cannot change the path', () => {
    const built = buildLogtoToolUrl(tool('get_user'), { id: '../applications' }, apiBase);

    expect('url' in built && built.url.pathname).toBe('/api/users/..%2Fapplications');
  });
});

describe('callLogtoTool', () => {
  it('sends Foundation stack reads to Kubo without the Logto token', async () => {
    const fetchImpl = jest.fn(async () => new Response('[]', { status: 200 }));

    await callLogtoTool(
      tool('list_foundation_stacks'),
      {},
      'caller-token',
      apiBase,
      fetchImpl as unknown as typeof fetch
    );

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toMatch(/\/api\/stacks$/);
    expect(String(url)).not.toContain(apiBase);
    expect(init.headers).not.toHaveProperty('authorization');
  });

  it('forwards the caller’s own token to the Management API', async () => {
    const fetchImpl = jest.fn(async () => new Response('{"id":"app-1"}', { status: 200 }));

    const result = await callLogtoTool(
      tool('get_application'),
      { id: 'app-1' },
      'caller-token',
      apiBase,
      fetchImpl as unknown as typeof fetch
    );

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe(`${apiBase}/applications/app-1`);
    expect(init.headers).toMatchObject({ authorization: 'Bearer caller-token' });
    expect(result).toEqual({ content: [{ type: 'text', text: '{"id":"app-1"}' }], isError: false });
  });

  it('reports a refused call as an error result with the Management API body', async () => {
    const fetchImpl = jest.fn(async () => new Response('{"message":"forbidden"}', { status: 403 }));

    const result = await callLogtoTool(
      tool('list_users'),
      {},
      'weak-token',
      apiBase,
      fetchImpl as unknown as typeof fetch
    );

    expect(result).toEqual({
      content: [{ type: 'text', text: '{"message":"forbidden"}' }],
      isError: true,
    });
  });

  it('does not call the Management API when the arguments are missing', async () => {
    const fetchImpl = jest.fn();

    const result = await callLogtoTool(
      tool('get_user'),
      {},
      'caller-token',
      apiBase,
      fetchImpl as unknown as typeof fetch
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
  });
});

describe('create tools', () => {
  it('posts the body built from the named fields only', async () => {
    const fetchImpl = jest.fn(async () => new Response('{"name":"Acme"}', { status: 201 }));

    const result = await callLogtoTool(
      tool('create_organization'),
      { name: 'Acme', description: 'Team', tenantId: 'other-tenant', id: 'forced-id' },
      'caller-token',
      apiBase,
      fetchImpl as unknown as typeof fetch
    );

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe(`${apiBase}/organizations`);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      authorization: 'Bearer caller-token',
      'content-type': 'application/json',
    });
    expect(JSON.parse(String(init.body))).toEqual({ name: 'Acme', description: 'Team' });
    expect(result.isError).toBe(false);
  });

  it('generates the id and secret an application needs', async () => {
    const fetchImpl = jest.fn(async () => new Response('{}', { status: 201 }));

    await callLogtoTool(
      tool('create_application'),
      { name: 'Web', type: 'SPA', redirect_uris: ['https://app.example.com/callback'] },
      'caller-token',
      apiBase,
      fetchImpl as unknown as typeof fetch
    );

    const [, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(sent).toMatchObject({
      name: 'Web',
      type: 'SPA',
      oidcClientMetadata: {
        redirectUris: ['https://app.example.com/callback'],
        postLogoutRedirectUris: [],
      },
    });
    expect(sent).not.toHaveProperty('id');
    expect(sent).not.toHaveProperty('secret');
  });
});

describe('enabledLogtoMcpTools', () => {
  it('lists the create tools', () => {
    const names = enabledLogtoMcpTools(true).map(({ name }) => name);

    expect(names).toContain('create_application');
    expect(names).toContain('create_organization');
  });
});

describe('get_sign_in_experience', () => {
  const settings = {
    id: 'default',
    signInMode: 'SignInAndRegister',
    signIn: { methods: [] },
    signUp: { identifiers: ['email'] },
    branding: { logoUrl: 'https://cdn.example.com/logo.png' },
    captchaPolicy: { provider: 'recaptcha', secretKey: 'do-not-send' },
    customUiAssets: { id: 'assets' },
    connectorTargets: ['internal-connector'],
  };

  it('hides the tool while dev features are disabled', () => {
    const names = enabledLogtoMcpTools(false).map(({ name }) => name);

    expect(names).not.toContain('get_sign_in_experience');
  });

  it('offers the tool while dev features are enabled', () => {
    const names = enabledLogtoMcpTools(true).map(({ name }) => name);

    expect(names).toContain('get_sign_in_experience');
  });

  it('passes only the allowlisted sign-in fields to the model', async () => {
    const fetchImpl = jest.fn(async () => new Response(JSON.stringify(settings), { status: 200 }));

    const result = await callLogtoTool(
      tool('get_sign_in_experience'),
      {},
      'caller-token',
      apiBase,
      fetchImpl as unknown as typeof fetch
    );

    const [url] = fetchImpl.mock.calls[0] as unknown as [URL];
    expect(String(url)).toBe(`${apiBase}/sign-in-exp`);
    expect(result.isError).toBe(false);

    const { text } = result.content[0] as { text: string };
    expect(JSON.parse(text)).toEqual({
      signInMode: 'SignInAndRegister',
      signIn: { methods: [] },
      signUp: { identifiers: ['email'] },
      branding: { logoUrl: 'https://cdn.example.com/logo.png' },
    });
    expect(text).not.toContain('do-not-send');
    expect(text).not.toContain('internal-connector');
  });

  it('returns a tool error when the body cannot be read, not the raw response', async () => {
    const fetchImpl = jest.fn(async () => new Response('not json', { status: 200 }));

    const result = await callLogtoTool(
      tool('get_sign_in_experience'),
      {},
      'caller-token',
      apiBase,
      fetchImpl as unknown as typeof fetch
    );

    expect(result).toEqual({
      content: [{ type: 'text', text: 'The response could not be read.' }],
      isError: true,
    });
  });
});

describe('logtoMcpTools', () => {
  it('exposes reads and creates only, never update or delete', () => {
    for (const { name } of logtoMcpTools) {
      expect(name).not.toMatch(/^(update|delete|remove|set|add)_/);
    }
  });

  it('marks every write tool as a POST with a body', () => {
    for (const candidate of logtoMcpTools.filter(({ name }) => name.startsWith('create_'))) {
      expect(candidate.method).toBe('POST');
      expect(candidate.body).toBeDefined();
    }
  });
});

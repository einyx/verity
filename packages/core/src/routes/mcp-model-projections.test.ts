import { toolResultFor } from './mcp-logto-response.js';
import { callLogtoTool, logtoMcpTools } from './mcp-logto-tools.js';

const secret = 'SENTINEL_PRIVATE_CREDENTIAL';
it('retains numeric Foundation readiness without forwarding stack diagnostics or configuration', () => {
  const result = toolResultFor(
    { name: 'list_foundation_stacks' },
    new Response(),
    JSON.stringify([
      {
        namespace: 'team',
        name: 'public-stack',
        mode: 'shared',
        phase: 'Ready',
        ready: 2,
        total: 2,
        age: '3d',
        failureMsg: secret,
        config: { credential: secret },
      },
    ])
  );
  expect(result.isError).toBe(false);
  expect(JSON.stringify(result)).toContain('public-stack');
  expect(JSON.stringify(result)).not.toContain(secret);
});
it.each(logtoMcpTools.map((tool) => [tool.name, tool] as const))(
  '%s strips unlisted and nested secret fields at the shared MCP boundary',
  async (name, tool) => {
    const item = {
      id: 'safe-id',
      secret,
      config: { accessKey: secret },
      customData: { token: secret },
      primaryEmail: secret,
      primaryPhone: secret,
      payload: { result: 'Error', params: { password: secret }, error: secret },
      oidcClientMetadata: { redirectUris: ['https://public.example/callback'], secret },
      branding: { logoUrl: 'https://public.example/logo', secret },
    };
    const body = name.startsWith('list_') || name === 'get_audit_logs' ? [item] : item;
    const result = await callLogtoTool(
      tool,
      { id: 'safe-id' },
      'synthetic-token',
      'https://tenant.example/api',
      async () => new Response(JSON.stringify(body))
    );
    expect(result.isError).toBe(false);
    expect(JSON.stringify(result)).not.toContain(secret);
  }
);

it.each([400, 403, 500])(
  'sanitizes HTTP %s failure diagnostics including echoed credentials',
  (status) => {
    const result = toolResultFor({ name: 'get_user' }, new Response(null, { status }), secret);
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain(secret);
  }
);

it('refuses unknown tools, malformed JSON and invalid shapes instead of forwarding raw results', () => {
  for (const [name, body] of [
    ['future_tool', `{"secret":"${secret}"}`],
    ['list_users', secret],
    ['get_user', '[]'],
  ]) {
    const result = toolResultFor({ name: name ?? '' }, new Response(), body ?? '');
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain(secret);
  }
});

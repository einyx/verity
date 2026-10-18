import { describe, expect, it, vi } from 'vitest';

import { createClientCredentialsToken } from './token.js';
import { createVaultSecrets } from './vault-secrets.js';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('vault secrets', () => {
  it('writes the secret under the connection path with the token header', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const secrets = createVaultSecrets({
      baseUrl: 'https://vault.example.com/',
      mount: 'secret',
      getToken: async () => 'vault-token',
      fetch: fetchMock as unknown as typeof fetch,
    });

    await secrets.putClientSecret('c1', 'shh');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://vault.example.com/v1/secret/data/console-sso/c1');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'x-vault-token': 'vault-token' });
    expect(JSON.parse(String(init.body))).toEqual({ data: { value: 'shh' } });
  });

  it('reads the secret back and returns undefined for a missing one', async () => {
    const secrets = createVaultSecrets({
      baseUrl: 'https://vault.example.com',
      mount: 'secret',
      getToken: async () => 'vault-token',
      fetch: (async (url: string) =>
        url.endsWith('/c1')
          ? jsonResponse({ data: { data: { value: 'shh' } } })
          : new Response(null, { status: 404 })) as unknown as typeof fetch,
    });

    expect(await secrets.getClientSecret('c1')).toBe('shh');
    expect(await secrets.getClientSecret('missing')).toBeUndefined();
  });

  it('fails loudly when Vault rejects a write', async () => {
    const secrets = createVaultSecrets({
      baseUrl: 'https://vault.example.com',
      mount: 'secret',
      getToken: async () => 'vault-token',
      fetch: (async () => new Response(null, { status: 403 })) as unknown as typeof fetch,
    });

    await expect(secrets.putClientSecret('c1', 'shh')).rejects.toThrow('403');
  });
});

describe('client credentials token', () => {
  it('requests the token once and reuses it until it nears expiry', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ access_token: 'm2m', expires_in: 3600 }));
    const getToken = createClientCredentialsToken({
      tokenEndpoint: 'https://auth.example.com/oidc/token',
      clientId: 'cloud',
      clientSecret: 'secret',
      resource: 'https://console.meshx.foundation/api',
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(await getToken()).toBe('m2m');
    expect(await getToken()).toBe('m2m');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws on a failed token request', async () => {
    const getToken = createClientCredentialsToken({
      tokenEndpoint: 'https://auth.example.com/oidc/token',
      clientId: 'cloud',
      clientSecret: 'wrong',
      resource: 'https://console.meshx.foundation/api',
      fetch: (async () => new Response(null, { status: 401 })) as unknown as typeof fetch,
    });

    await expect(getToken()).rejects.toThrow('401');
  });
});

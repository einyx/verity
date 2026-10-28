import { describe, expect, it, type Mock, vi } from 'vitest';

import {
  type CoreConnectorPayload,
  createInMemorySecrets,
  microsoftIssuer,
  syncCoreBinding,
  toCoreConnectorPayload,
  type CoreSsoClient,
} from './core-binding.js';
import { createCoreSsoClient } from './core-client.js';

const connector = { id: 'c1', provider: 'google' as const, displayName: 'Acme', clientId: 'cid' };

type FakeCore = {
  createConnector: Mock<(payload: CoreConnectorPayload) => Promise<{ id: string }>>;
  updateConnectorDomains: Mock<(connectorId: string, domains: string[]) => Promise<void>>;
};

const fakeCore = (): CoreSsoClient & FakeCore => ({
  createConnector: vi.fn(async () => ({ id: 'core-1' })),
  updateConnectorDomains: vi.fn().mockResolvedValue(null),
});

describe('core payload', () => {
  it('maps Google to the GoogleWorkspace connector with the secret from the store', () => {
    expect(
      toCoreConnectorPayload({
        provider: 'google',
        displayName: 'Acme',
        clientId: 'cid',
        clientSecret: 'secret',
        domains: ['acme.com'],
      })
    ).toEqual({
      providerName: 'GoogleWorkspace',
      connectorName: 'Acme',
      config: { clientId: 'cid', clientSecret: 'secret' },
      domains: ['acme.com'],
    });
  });

  it('maps Microsoft to AzureAdOidc with the Entra issuer', () => {
    const payload = toCoreConnectorPayload({
      provider: 'microsoft',
      displayName: 'Acme',
      clientId: 'cid',
      clientSecret: 'secret',
      domains: ['acme.com'],
    });

    expect(payload.providerName).toBe('AzureAdOidc');
    expect(payload.config.issuer).toBe(microsoftIssuer);
  });
});

describe('syncCoreBinding', () => {
  it('creates the core connector on the first verified domain and returns its ID', async () => {
    const secrets = createInMemorySecrets();
    await secrets.putClientSecret('c1', 'secret');
    const core = fakeCore();

    const id = await syncCoreBinding({
      connector,
      verifiedDomains: ['acme.com'],
      core,
      secrets,
    });

    expect(id).toBe('core-1');
    expect(core.createConnector).toHaveBeenCalledWith(
      expect.objectContaining({ providerName: 'GoogleWorkspace', domains: ['acme.com'] }) as Record<
        string,
        unknown
      >
    );
  });

  it('refuses to create a binding without a stored client secret', async () => {
    await expect(
      syncCoreBinding({
        connector,
        verifiedDomains: ['acme.com'],
        core: fakeCore(),
        secrets: createInMemorySecrets(),
      })
    ).rejects.toThrow('Client secret is missing');
  });

  it('updates the domains of an existing core connector instead of creating another', async () => {
    const core = fakeCore();

    const id = await syncCoreBinding({
      connector: { ...connector, coreConnectorId: 'core-1' },
      verifiedDomains: ['acme.com', 'acme.co.uk'],
      core,
      secrets: createInMemorySecrets(),
    });

    expect(id).toBe('core-1');
    expect(core.createConnector).not.toHaveBeenCalled();
    expect(core.updateConnectorDomains).toHaveBeenCalledWith('core-1', ['acme.com', 'acme.co.uk']);
  });
});

describe('core SSO client', () => {
  it('sends the token and payload, and returns the created connector ID', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ id: 'core-9' }), { status: 201 })
    );
    const client = createCoreSsoClient({
      baseUrl: 'https://console.example.com/api/',
      getAccessToken: async () => 'token',
      fetch: fetchMock as unknown as typeof fetch,
    });

    const created = await client.createConnector({
      providerName: 'GoogleWorkspace',
      connectorName: 'Acme',
      config: { clientId: 'cid', clientSecret: 'secret' },
      domains: ['acme.com'],
    });

    expect(created).toEqual({ id: 'core-9' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://console.example.com/api/sso-connectors');
    expect(init.headers).toMatchObject({ authorization: 'Bearer token' });
  });

  it('throws on a failed response so no half-made binding is stored', async () => {
    const client = createCoreSsoClient({
      baseUrl: 'https://core.example/api',
      getAccessToken: async () => 'token',
      fetch: (async () => new Response('nope', { status: 422 })) as unknown as typeof fetch,
    });

    await expect(client.updateConnectorDomains('core-1', ['acme.com'])).rejects.toThrow('422');
  });
});

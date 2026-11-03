import { EnvSet } from '#src/env-set/index.js';

import {
  managedPortalHosting,
  managedPortalHostname,
  portalHostingStatus,
} from './mcp-portal-hostnames.js';

const { jest } = import.meta;
const originalFlag = EnvSet.values.isDevFeaturesEnabled;
const originalDomain = process.env.MCP_PORTAL_MANAGED_DOMAIN;
const mockFetch = (implementation?: typeof fetch) =>
  jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(implementation);

afterEach(() => {
  Reflect.set(EnvSet.values, 'isDevFeaturesEnabled', originalFlag);
  if (originalDomain === undefined) {
    Reflect.deleteProperty(process.env, 'MCP_PORTAL_MANAGED_DOMAIN');
  } else {
    Reflect.set(process.env, 'MCP_PORTAL_MANAGED_DOMAIN', originalDomain);
  }
});

describe('managed portal hosting', () => {
  it('is disabled without the feature guard, even if a deployment domain is set', () => {
    Reflect.set(EnvSet.values, 'isDevFeaturesEnabled', false);
    Reflect.set(process.env, 'MCP_PORTAL_MANAGED_DOMAIN', 'meshx.foundation');
    expect(managedPortalHosting()).toBeUndefined();
  });

  it('exposes the deployment-owned domain and suffix', () => {
    Reflect.set(EnvSet.values, 'isDevFeaturesEnabled', true);
    Reflect.set(process.env, 'MCP_PORTAL_MANAGED_DOMAIN', 'meshx.foundation');
    expect(managedPortalHosting()).toEqual({
      baseDomain: 'meshx.foundation',
      hostnameSuffix: '-mcp',
      managed: true,
    });
  });

  it.each(['', '*.meshx.foundation', 'https://meshx.foundation', 'localhost'])(
    'refuses invalid deployment domain %s',
    (value) => {
      Reflect.set(EnvSet.values, 'isDevFeaturesEnabled', true);
      Reflect.set(process.env, 'MCP_PORTAL_MANAGED_DOMAIN', value);
      expect(managedPortalHosting()).toBeUndefined();
    }
  );

  it('generates a unique, single-level address from the name', () => {
    const first = managedPortalHostname('meshx.foundation', 'Engineering Team');
    const second = managedPortalHostname('meshx.foundation', 'Engineering Team');
    expect(first).toMatch(/^engineering-team-[\da-f]{8}-mcp\.meshx\.foundation$/);
    expect(first).not.toBe(second);
  });

  it('handles non-Latin names and bounds a long name to a valid DNS label', () => {
    expect(managedPortalHostname('meshx.foundation', '测试')).toMatch(/^portal-[\da-f]{8}-mcp\./);
    expect(
      managedPortalHostname('meshx.foundation', 'a'.repeat(100))?.split('.')[0]?.length
    ).toBeLessThanOrEqual(63);
  });

  it('preserves explicit labels and reserves space for the suffix', () => {
    expect(managedPortalHostname('meshx.foundation', 'Test', 'test')).toBe(
      'test-mcp.meshx.foundation'
    );
    expect(managedPortalHostname('meshx.foundation', 'Test', 'a'.repeat(59))).toBeDefined();
    expect(managedPortalHostname('meshx.foundation', 'Test', 'a'.repeat(60))).toBeUndefined();
    expect(managedPortalHostname('meshx.foundation', 'Test', 'test.other')).toBeUndefined();
  });
});

describe('portal hosting readiness', () => {
  it('requires matching HTTPS discovery before marking a portal ready', async () => {
    const fetchImpl = mockFetch(
      async () =>
        new Response(
          JSON.stringify({
            resource: 'https://test-mcp.meshx.foundation/mcp',
          })
        )
    );
    expect(
      await portalHostingStatus('test-mcp.meshx.foundation', 'meshx.foundation', fetchImpl)
    ).toEqual({ status: 'ready' });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://test-mcp.meshx.foundation/.well-known/oauth-protected-resource'
    );
    expect(fetchImpl.mock.calls[0]?.[1]?.redirect).toBe('error');
    expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each(['https://other-mcp.meshx.foundation/mcp', undefined])(
    'does not trust mismatched discovery: %s',
    async (resource) => {
      const fetchImpl = mockFetch(async () => new Response(JSON.stringify({ resource })));
      expect(
        await portalHostingStatus('test-mcp.meshx.foundation', 'meshx.foundation', fetchImpl)
      ).toEqual({ status: 'pending' });
    }
  );

  it('keeps DNS, TLS and network failures pending', async () => {
    const fetchImpl = mockFetch(async () => {
      throw new Error('TLS handshake failed');
    });
    expect(
      await portalHostingStatus('test-mcp.meshx.foundation', 'meshx.foundation', fetchImpl)
    ).toEqual({ status: 'pending' });
  });

  it.each([new Response('x'.repeat(8193)), new Response('unavailable', { status: 503 })])(
    'bounds the discovery response and refuses HTTP errors: %s',
    async (response) => {
      const fetchImpl = mockFetch(async () => response);
      expect(
        await portalHostingStatus('test-mcp.meshx.foundation', 'meshx.foundation', fetchImpl)
      ).toEqual({ status: 'pending' });
    }
  );

  it.each([
    'test.mcp.meshx.foundation',
    'test-mcp.meshx.foundation.evil.example',
    'console.meshx.foundation',
    'https://test-mcp.meshx.foundation',
    'test-mcp.meshx.foundation:443',
    '127.0.0.1',
  ])('never probes an unmanaged destination: %s', async (hostname) => {
    const fetchImpl = mockFetch();
    expect(await portalHostingStatus(hostname, 'meshx.foundation', fetchImpl)).toEqual({
      status: 'unmanaged',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

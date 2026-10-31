import { ApplicationType } from '@logto/schemas';
import { GlobalValues } from '@logto/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildTestApplications, getTestApplicationEndpoints } from './test-applications.js';

describe('registered integration test applications', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds public login and device clients that do not require the built-in demo feature', () => {
    const applications = buildTestApplications([new URL('http://localhost:3001')]);

    expect(applications).toHaveLength(2);
    expect(applications[0]).toMatchObject({
      tenantId: 'default',
      id: 'demo-app',
      type: ApplicationType.SPA,
      isThirdParty: false,
      oidcClientMetadata: {
        redirectUris: ['http://localhost:3001/demo-app'],
        postLogoutRedirectUris: ['http://localhost:3001/demo-app'],
      },
    });
    expect(applications[1]).toMatchObject({
      tenantId: 'default',
      id: 'device-demo-app',
      type: ApplicationType.Native,
      customClientMetadata: { isDeviceFlow: true },
      oidcClientMetadata: {
        redirectUris: [],
        postLogoutRedirectUris: ['http://localhost:3001/device-demo-app'],
      },
    });
  });

  it('registers only the configured callback origins, preserving their path prefixes', () => {
    const [login, device] = buildTestApplications([
      new URL('http://localhost:3001'),
      new URL('https://login.example.test/test/'),
    ]);

    expect(login?.oidcClientMetadata.redirectUris).toEqual([
      'http://localhost:3001/demo-app',
      'https://login.example.test/test/demo-app',
    ]);
    expect(device?.oidcClientMetadata.postLogoutRedirectUris).toEqual([
      'http://localhost:3001/device-demo-app',
      'https://login.example.test/test/device-demo-app',
    ]);
  });

  it('resolves the default tenant to the bare domain without registering wildcard callbacks', () => {
    vi.stubEnv('DB_URL', 'postgres://localhost/fixture-config-only');
    vi.stubEnv('ENDPOINT', 'https://*.example.test');
    vi.stubEnv('DISABLE_LOCALHOST', '0');

    expect(getTestApplicationEndpoints(new GlobalValues()).map(String)).toEqual([
      'https://example.test/',
    ]);
  });

  it('includes the default tenant path on configured and localhost endpoints', () => {
    vi.stubEnv('DB_URL', 'postgres://localhost/fixture-config-only');
    vi.stubEnv('ENDPOINT', 'https://example.test/base');
    vi.stubEnv('PATH_BASED_MULTI_TENANCY', '1');
    vi.stubEnv('DISABLE_LOCALHOST', '0');
    vi.stubEnv('PORT', '3001');

    expect(getTestApplicationEndpoints(new GlobalValues()).map(String)).toEqual([
      'http://localhost:3001/default',
      'https://example.test/base/default',
    ]);
  });
});

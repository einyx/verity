import { GlobalValues } from '@logto/shared';
import { createMockUtils } from '@logto/shared/esm';
import nock from 'nock';

import { mockLogtoConfigsLibrary } from '#src/test-utils/mock-libraries.js';

import { type LogtoConfigLibrary } from './logto-config.js';

const { jest } = import.meta;
const { mockEsmWithActual } = createMockUtils(jest);

const adminEndpoint = 'http://mock.com';
const mockAccessToken = 'mockAccessToken';
await mockEsmWithActual('#src/env-set/index.js', () => ({
  EnvSet: {
    get values() {
      const values = new GlobalValues();

      return {
        ...values,
        isCloud: true,
        cloudUrlSet: { ...values.cloudUrlSet, endpoint: new URL(adminEndpoint) },
        urlSet: { ...values.urlSet, localhostUrl: new URL('http://127.0.0.1:3001') },
        adminUrlSet: {
          ...values.adminUrlSet,
          endpoint: new URL(adminEndpoint),
        },
      };
    },
  },
}));

const { createCloudConnectionLibrary } = await import('./cloud-connection.js');
const { EnvSet } = await import('#src/env-set/index.js');

const logtoConfigs: LogtoConfigLibrary = {
  ...mockLogtoConfigsLibrary,
  getCloudConnectionData: jest.fn().mockResolvedValue({
    appId: 'appId',
    appSecret: 'appSecret',
    resource: 'resource',
  }),
};

describe('getAccessToken()', () => {
  const { getAccessToken } = createCloudConnectionLibrary(logtoConfigs);

  it('should get access token and cached', async () => {
    nock(adminEndpoint).post('/oidc/token').reply(200, {
      access_token: mockAccessToken,
      expires_in: 3600,
      token_type: 'Bearer',
    });
    const token = await getAccessToken();
    expect(token).toBe(mockAccessToken);

    nock(adminEndpoint).post('/oidc/token').reply(200, {
      access_token: 'anotherAccessToken',
      expires_in: 3600,
      token_type: 'Bearer',
    });
    const cachedToken = await getAccessToken();
    expect(cachedToken).toBe(mockAccessToken);
  });
});

describe('deployment-owned internal Cloud transport', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    nock.cleanAll();
  });

  it('mints tokens and reads subscription quota through loopback with canonical routing', async () => {
    jest.replaceProperty(process, 'env', { ...process.env, CLOUD_INTERNAL_TRANSPORT: 'true' });
    nock.cleanAll();
    const internal = nock('http://127.0.0.1:3001', {
      reqheaders: { host: 'mock.com', 'x-forwarded-host': 'mock.com', 'x-forwarded-proto': 'http' },
    })
      .post('/oidc/token')
      .reply(200, { access_token: mockAccessToken, expires_in: 3600, token_type: 'Bearer' })
      .get('/api/tenants/my/subscription')
      .matchHeader('authorization', `Bearer ${mockAccessToken}`)
      .reply(200, { quota: { customJwtEnabled: true } });
    const library = createCloudConnectionLibrary(logtoConfigs);
    const client = await library.getClient();
    await expect(client.get('/api/tenants/my/subscription')).resolves.toEqual({
      quota: { customJwtEnabled: true },
    });
    expect(internal.isDone()).toBe(true);
    const data = await library.getCloudConnectionData();
    expect(data.tokenEndpoint).toBe(`${adminEndpoint}/oidc/token`);
  });

  it('does not fall back to the edge when the internal listener fails', async () => {
    jest.replaceProperty(process, 'env', { ...process.env, CLOUD_INTERNAL_TRANSPORT: 'true' });
    nock.cleanAll();
    nock('http://127.0.0.1:3001').post('/oidc/token').reply(503);
    const edge = nock(adminEndpoint).post('/oidc/token').reply(200, {
      access_token: mockAccessToken,
      expires_in: 3600,
      token_type: 'Bearer',
    });
    await expect(createCloudConnectionLibrary(logtoConfigs).getAccessToken()).rejects.toThrow();
    expect(edge.isDone()).toBe(false);
  });

  it.each(['external-listener', 'remote-cloud', 'non-cloud'])(
    'rejects unsafe opt-in: %s',
    async (mode) => {
      jest.replaceProperty(process, 'env', { ...process.env, CLOUD_INTERNAL_TRANSPORT: 'true' });
      const { values } = EnvSet;
      jest.spyOn(EnvSet, 'values', 'get').mockReturnValue({
        ...values,
        isCloud: mode !== 'non-cloud',
        urlSet: {
          ...values.urlSet,
          localhostUrl: new URL(
            mode === 'external-listener' ? 'http://untrusted.example' : 'http://127.0.0.1:3001'
          ),
        },
        cloudUrlSet: {
          ...values.cloudUrlSet,
          endpoint: new URL(mode === 'remote-cloud' ? 'https://remote.example' : adminEndpoint),
        },
      } as unknown as GlobalValues);
      await expect(createCloudConnectionLibrary(logtoConfigs).getAccessToken()).rejects.toThrow(
        'Internal Cloud transport requires'
      );
    }
  );

  it('does not follow a token endpoint redirect with credentials', async () => {
    jest.replaceProperty(process, 'env', { ...process.env, CLOUD_INTERNAL_TRANSPORT: 'true' });
    nock.cleanAll();
    nock('http://127.0.0.1:3001')
      .post('/oidc/token')
      .reply(307, undefined, { location: 'https://untrusted.example/token' });
    const destination = nock('https://untrusted.example').post('/token').reply(200);
    await expect(createCloudConnectionLibrary(logtoConfigs).getAccessToken()).rejects.toThrow();
    expect(destination.isDone()).toBe(false);
  });
});

describe('getWorkerAccessToken()', () => {
  const { getAccessToken, getWorkerAccessToken } = createCloudConnectionLibrary(logtoConfigs);
  const mockWorkerAccessToken = 'mockWorkerAccessToken';

  beforeEach(() => {
    // Drop interceptors the previous describe left unconsumed — nock matching is global FIFO.
    nock.cleanAll();
  });

  it('should mint the token for the worker resource and scope, cached separately', async () => {
    nock(adminEndpoint)
      .post(
        '/oidc/token',
        (body: Record<string, string>) =>
          body.resource === 'https://*.logto.workers.dev' &&
          body.scope === 'invoke:worker:script-run'
      )
      .reply(200, {
        access_token: mockWorkerAccessToken,
        expires_in: 3600,
        token_type: 'Bearer',
      });

    const token = await getWorkerAccessToken();
    expect(token).toBe(mockWorkerAccessToken);

    // The Cloud service token cache must not be shared — the audiences differ.
    nock(adminEndpoint)
      .post('/oidc/token', (body: Record<string, string>) => body.resource === 'resource')
      .reply(200, {
        access_token: mockAccessToken,
        expires_in: 3600,
        token_type: 'Bearer',
      });

    const cloudToken = await getAccessToken();
    expect(cloudToken).toBe(mockAccessToken);

    // Cached: no further request is mounted, so a miss would throw from nock.
    const cachedToken = await getWorkerAccessToken();
    expect(cachedToken).toBe(mockWorkerAccessToken);
  });

  it('should drop the cached token when invalidated', async () => {
    const { getWorkerAccessToken, invalidateWorkerAccessToken } =
      createCloudConnectionLibrary(logtoConfigs);

    nock(adminEndpoint).post('/oidc/token').reply(200, {
      access_token: mockWorkerAccessToken,
      expires_in: 3600,
      token_type: 'Bearer',
    });

    await expect(getWorkerAccessToken()).resolves.toBe(mockWorkerAccessToken);

    invalidateWorkerAccessToken();

    nock(adminEndpoint).post('/oidc/token').reply(200, {
      access_token: 'rotatedWorkerAccessToken',
      expires_in: 3600,
      token_type: 'Bearer',
    });

    await expect(getWorkerAccessToken()).resolves.toBe('rotatedWorkerAccessToken');
  });
});

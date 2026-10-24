import nock from 'nock';

import { accessTokenEndpoint, authorizationEndpoint } from './constant.js';
import createConnector, { getAccessToken } from './index.js';
import { mockedConfig } from './mock.js';

const getConfig = vi.fn().mockResolvedValue(mockedConfig);
const setSession = vi.fn();
const redirectUri = 'http://localhost:3000/callback';
const getSession = vi.fn().mockResolvedValue({
  redirectUri,
});

describe('getAuthorizationUri', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should get a valid uri by redirectUri and state', async () => {
    const connector = await createConnector({ getConfig });
    const authorizationUri = await connector.getAuthorizationUri(
      {
        state: 'some_state',
        redirectUri,
        connectorId: 'some_connector_id',
        connectorFactoryId: 'some_connector_factory_id',
        jti: 'some_jti',
        headers: {},
      },
      setSession
    );
    expect(setSession).toHaveBeenCalledWith({
      redirectUri,
    });
    expect(authorizationUri).toEqual(
      `${authorizationEndpoint}?response_type=code&client_id=%3Cclient-id%3E&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcallback&scope=openid+profile+email&state=some_state`
    );
  });

  it('should get a valid uri with custom scope', async () => {
    const connector = await createConnector({ getConfig });
    const authorizationUri = await connector.getAuthorizationUri(
      {
        state: 'some_state',
        redirectUri,
        connectorId: 'some_connector_id',
        connectorFactoryId: 'some_connector_factory_id',
        jti: 'some_jti',
        scope: 'custom_scope',
        headers: {},
      },
      setSession
    );

    expect(authorizationUri).toEqual(
      `${authorizationEndpoint}?response_type=code&client_id=%3Cclient-id%3E&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcallback&scope=custom_scope&state=some_state`
    );
  });
});

describe('getAccessToken', () => {
  afterEach(() => {
    nock.cleanAll();
    vi.clearAllMocks();
  });

  it('should get an accessToken by exchanging with code', async () => {
    nock(accessTokenEndpoint).post('').reply(200, {
      ok: true,
      access_token: 'access_token',
      token_type: 'token_type',
      id_token: mockIdToken,
    });
    const { access_token, id_token } = await getAccessToken(mockedConfig, 'code', redirectUri);
    expect(access_token).toEqual('access_token');
    expect(id_token).toEqual(mockIdToken);
  });
});

const mockIdToken = [
  Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'none' })).toString('base64url'),
  Buffer.from(
    JSON.stringify({
      sub: '1234567890',
      name: 'John Doe',
      picture: 'https://example.com/jphodoe.jpg',
    })
  ).toString('base64url'),
  '',
].join('.');

describe('getUserInfo', () => {
  afterEach(() => {
    nock.cleanAll();
    vi.clearAllMocks();
  });

  it('should get valid SocialUserInfo', async () => {
    nock(accessTokenEndpoint).post('').query(true).reply(200, {
      ok: true,
      access_token: 'access_token',
      token_type: 'token_type',
      id_token: mockIdToken,
    });
    const connector = await createConnector({ getConfig });
    const socialUserInfo = await connector.getUserInfo({ code: 'code', redirectUri }, getSession);
    expect(socialUserInfo).toStrictEqual({
      id: '1234567890',
      name: 'John Doe',
      image: 'https://example.com/jphodoe.jpg',
      email: undefined,
      rawData: {
        sub: '1234567890',
        name: 'John Doe',
        picture: 'https://example.com/jphodoe.jpg',
      },
    });
  });

  it('throws unrecognized error', async () => {
    nock(accessTokenEndpoint).post('').reply(500);
    const connector = await createConnector({ getConfig });
    await expect(connector.getUserInfo({ code: 'code' }, vi.fn())).rejects.toThrow();
  });
});

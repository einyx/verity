import { CloudScope } from '@logto/schemas';

import type { EnvSet } from '#src/env-set/index.js';

const { jest } = import.meta;
const verifyBearerTokenFromRequest = jest.fn();
jest.unstable_mockModule('#src/middleware/koa-auth/index.js', () => ({
  verifyBearerTokenFromRequest,
}));
jest.unstable_mockModule('#src/env-set/index.js', () => ({
  EnvSet: { values: { cloudUrlSet: { endpoint: new URL('https://console.example.com') } } },
}));

const { getLandingPageAiToken } = await import('./ai-chat-landing-page-auth.js');
const envSet = {} as unknown as EnvSet;

beforeEach(() => {
  verifyBearerTokenFromRequest.mockReset();
  verifyBearerTokenFromRequest.mockResolvedValue({
    sub: 'user-a',
    clientId: 'console',
    scopes: [CloudScope.ManageLandingPage],
  });
});

it('validates the separate Cloud token with its audience and binds it to the caller', async () => {
  await expect(getLandingPageAiToken(envSet, 'Bearer cloud-token', 'user-a')).resolves.toBe(
    'cloud-token'
  );
  expect(verifyBearerTokenFromRequest).toHaveBeenCalledWith(
    envSet,
    { headers: { authorization: 'Bearer cloud-token' } },
    expect.stringContaining('console.example.com')
  );
});

it('does not fall back to the tenant Management API token', async () => {
  await expect(getLandingPageAiToken(envSet, '', 'user-a')).rejects.toThrow();
  expect(verifyBearerTokenFromRequest).not.toHaveBeenCalled();
});

it.each([
  { sub: 'other-user', clientId: 'console', scopes: [CloudScope.ManageLandingPage] },
  { sub: 'console', clientId: 'console', scopes: [CloudScope.ManageLandingPage] },
  { sub: 'user-a', clientId: 'console', scopes: [] },
])('rejects mismatched users, machine tokens and missing permissions: %j', async (tokenInfo) => {
  verifyBearerTokenFromRequest.mockResolvedValue(tokenInfo);
  await expect(getLandingPageAiToken(envSet, 'Bearer cloud-token', 'user-a')).rejects.toThrow();
});

it('rejects an invalid or expired Cloud token', async () => {
  verifyBearerTokenFromRequest.mockRejectedValue(new Error('invalid token'));
  await expect(getLandingPageAiToken(envSet, 'Bearer cloud-token', 'user-a')).rejects.toThrow(
    'invalid token'
  );
});

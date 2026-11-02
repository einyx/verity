import { adminTenantId, CloudScope, getCloudApiIndicator } from '@logto/schemas';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

import type { EnvSet } from '#src/env-set/index.js';

const { jest } = import.meta;
const endpoint = new URL('https://console.synthetic.test');
jest.unstable_mockModule('#src/env-set/index.js', () => ({
  EnvSet: { values: { isProduction: true, isIntegrationTest: false, cloudUrlSet: { endpoint } } },
  getTenantEndpoint: jest.fn(),
}));
const { getLandingPageAiToken } = await import('./ai-chat-landing-page-auth.js');
const { resolveLandingPageCapability } = await import('./ai-chat-landing-page-capability.js');
const { publicKey, privateKey } = await generateKeyPair('RS256');
const publicJwk = await exportJWK(publicKey);
const issuer = 'https://admin.synthetic.test/oidc';
const audience = getCloudApiIndicator(endpoint.origin);
const envSet = {
  tenantId: adminTenantId,
  oidc: { publicJwks: [publicJwk], issuer },
} as unknown as EnvSet;

it.each([
  {
    label: 'authorized human',
    sub: 'human',
    scope: CloudScope.ManageLandingPage,
    aud: audience,
    expired: false,
    state: 'authorized',
  },
  {
    label: 'read-only viewer',
    sub: 'human',
    scope: 'read:tenant',
    aud: audience,
    expired: false,
    state: 'forbidden',
  },
  {
    label: 'customer without landing scope',
    sub: 'human',
    scope: '',
    aud: audience,
    expired: false,
    state: 'forbidden',
  },
  {
    label: 'other account',
    sub: 'other',
    scope: CloudScope.ManageLandingPage,
    aud: audience,
    expired: false,
    state: 'forbidden',
  },
  {
    label: 'machine',
    sub: 'console-client',
    scope: CloudScope.ManageLandingPage,
    aud: audience,
    expired: false,
    state: 'forbidden',
  },
  {
    label: 'wrong audience',
    sub: 'human',
    scope: CloudScope.ManageLandingPage,
    aud: 'https://tenant.synthetic.test/api',
    expired: false,
    state: 'authentication_required',
  },
  {
    label: 'expired',
    sub: 'human',
    scope: CloudScope.ManageLandingPage,
    aud: audience,
    expired: true,
    state: 'authentication_required',
  },
])('verifies signed JWT authorization: $label', async ({ sub, scope, aud, expired, state }) => {
  const token = await new SignJWT({ client_id: 'console-client', scope })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject(sub)
    .setIssuer(issuer)
    .setAudience(aud)
    .setExpirationTime(expired ? Math.floor(Date.now() / 1000) - 60 : '5m')
    .sign(privateKey);
  const capability = await resolveLandingPageCapability(async () =>
    getLandingPageAiToken(envSet, `Bearer ${token}`, 'human')
  );
  expect(capability).toBe(state);
});

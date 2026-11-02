import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  adminTenantId,
  CloudScope,
  defaultLandingPageContent,
  getCloudApiIndicator,
} from '@logto/schemas';
import i18next from 'i18next';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import Koa from 'koa';

import type { EnvSet } from '#src/env-set/index.js';

const { jest } = import.meta;
const canonical = new URL('https://console.meshx.foundation');
const values = {
  isCloud: true,
  isProduction: true,
  isIntegrationTest: false,
  isUnitTest: true,
  cloudUrlSet: { endpoint: canonical },
  adminUrlSet: { endpoint: canonical },
  urlSet: { localhostUrl: new URL('http://127.0.0.1:1') },
};
const query = jest.fn(async () => {
  throw new Error('Page writes are forbidden in this test');
});
const maybeOne = jest.fn(async () => ({
  draft: defaultLandingPageContent,
  published: defaultLandingPageContent,
  publishedVersion: 1,
}));
const provider = jest.fn();
jest.unstable_mockModule('#src/env-set/index.js', () => ({
  EnvSet: { values, sharedPool: { maybeOne, query } },
  getTenantEndpoint: jest.fn(),
}));
jest.unstable_mockModule('got', () => ({
  got: { post: provider },
  HTTPError: class extends Error {},
}));
jest.unstable_mockModule('@logto/app-insights/node', () => ({
  appInsights: { trackException: jest.fn() },
}));
const { landingPageRoutes } = await import('./landing-page.js');
const { getLandingPageAiToken } = await import('./ai-chat-landing-page-auth.js');
const { editLandingPageDraft } = await import('./ai-chat-landing-page.js');
const { createCloudApiFetch } = await import('#src/libraries/cloud-transport.js');
const { probeLandingPageEditor } = await import('./ai-chat-landing-page-probe.js');
const { default: koaErrorHandler } = await import('#src/middleware/koa-error-handler.js');
const { publicKey, privateKey } = await generateKeyPair('RS256');
const issuer = `${canonical.origin}/oidc`;
const audience = getCloudApiIndicator(canonical.origin);
const envSet = {
  tenantId: adminTenantId,
  oidc: { publicJwks: [await exportJWK(publicKey)], issuer },
} as unknown as EnvSet;
const seen = jest.fn();
const state: { server?: Server } = {};
const mint = async (
  options: { scope?: string; sub?: string; aud?: string; iss?: string; expired?: boolean } = {}
) =>
  new SignJWT({ client_id: 'console-client', scope: options.scope ?? CloudScope.ManageLandingPage })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject(options.sub ?? 'same-human')
    .setIssuer(options.iss ?? issuer)
    .setAudience(options.aud ?? audience)
    .setExpirationTime(options.expired ? Math.floor(Date.now() / 1000) - 60 : '5m')
    .sign(privateKey);

beforeAll(async () => {
  const app = new Koa();
  // eslint-disable-next-line @silverhand/fp/no-mutation -- Configure only this local HTTP test server, as the production proxy middleware does.
  app.proxy = true;
  // eslint-disable-next-line @silverhand/fp/no-mutation -- RequestError serialization needs the test's already initialized translator.
  app.context.i18n = i18next;
  app.use(koaErrorHandler());
  app.use(async (ctx, next) => {
    seen({ path: ctx.path, method: ctx.method, host: ctx.host, protocol: ctx.protocol });
    await next();
  });
  app.use(landingPageRoutes(envSet).routes());
  await new Promise<void>((resolve) => {
    // eslint-disable-next-line @silverhand/fp/no-mutation -- Retain the owned ephemeral listener for teardown.
    state.server = app.listen(0, '127.0.0.1', resolve);
  });
  // eslint-disable-next-line @silverhand/fp/no-mutation -- The OS assigns the fixture port; never use a shared or production listener.
  values.urlSet.localhostUrl = new URL(
    `http://127.0.0.1:${(state.server!.address() as AddressInfo).port}`
  );
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    state.server?.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
});
beforeEach(() => {
  jest.replaceProperty(process, 'env', {
    ...process.env,
    CLOUD_INTERNAL_TRANSPORT: 'true',
    OPENAI_API_KEY: 'synthetic-provider-key',
  });
  query.mockClear();
  maybeOne.mockClear();
  seen.mockClear();
  provider.mockReset();
});
afterEach(() => {
  jest.restoreAllMocks();
});

it('uses the actual Cloud editor route and JWT verifier over loopback, retaining the canonical identity and human credential', async () => {
  const token = await mint();
  const verified = await getLandingPageAiToken(envSet, `Bearer ${token}`, 'same-human');
  expect(verified === token).toBe(true);
  const edited = {
    ...defaultLandingPageContent,
    sections: defaultLandingPageContent.sections.map((section) =>
      section.id === 'trust' ? { ...section, heading: 'Verified HTTP improvement' } : section
    ),
  };
  provider.mockResolvedValue({
    body: { choices: [{ message: { content: JSON.stringify(edited) } }] },
  });
  const localOnlyFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== values.urlSet.localhostUrl.origin) {
      throw new Error('Public edge self-call attempted');
    }
    expect(new Headers(init?.headers).get('authorization') === `Bearer ${token}`).toBe(true);
    const response = await fetch(input, init);
    expect({ status: response.status, providerCalled: provider.mock.calls.length > 0 }).toEqual({
      status: 200,
      providerCalled: url.pathname.endsWith('/ai-edit'),
    });
    return response;
  };
  expect(
    await editLandingPageDraft({
      instruction: 'Improve the landing page title for preview only',
      apiBase: `${canonical.origin}/api`,
      token: verified,
      fetchImpl: localOnlyFetch,
    })
  ).toEqual(edited);
  expect(seen.mock.calls.map(([metadata]) => metadata)).toEqual([
    { path: '/api/landing-page/editor', method: 'GET', host: canonical.host, protocol: 'https' },
    { path: '/api/landing-page/ai-edit', method: 'POST', host: canonical.host, protocol: 'https' },
  ]);
  expect(provider).toHaveBeenCalledTimes(1);
  expect(query).not.toHaveBeenCalled();
});

it.each([
  [{ scope: 'read:tenant' }, 403],
  [{ sub: 'console-client' }, 403],
  [{ aud: 'https://wrong.example/api' }, 401],
  [{ iss: 'https://wrong.example/oidc' }, 401],
  [{ expired: true }, 401],
] as const)('the real Cloud route still rejects invalid authority: %j', async (claims, status) => {
  const token = await mint(claims);
  const response = await createCloudApiFetch()(new URL('/api/landing-page/editor', canonical), {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toContain('application/json');
  await response.body?.cancel();
  expect(provider).not.toHaveBeenCalled();
  expect(maybeOne).not.toHaveBeenCalled();
  expect(query).not.toHaveBeenCalled();
});

it('rejects another human at the management-to-Cloud boundary before any HTTP or generation', async () => {
  const token = await mint({ sub: 'other-human' });
  await expect(
    getLandingPageAiToken(envSet, `Bearer ${token}`, 'same-human')
  ).rejects.toMatchObject({ status: 403 });
  expect(seen).not.toHaveBeenCalled();
  expect(provider).not.toHaveBeenCalled();
  expect(query).not.toHaveBeenCalled();
});

it('diagnoses the actual protected editor GET with metadata only, never AI or a page write', async () => {
  const token = await mint();
  const metadata = await probeLandingPageEditor(`${canonical.origin}/api`, async () =>
    getLandingPageAiToken(envSet, `Bearer ${token}`, 'same-human')
  );
  expect(metadata).toEqual({
    editorStatus: 200,
    editorApplicationJson: true,
    editorChallenge: false,
    editorUsesInternalTransport: true,
  });
  expect(provider).not.toHaveBeenCalled();
  expect(query).not.toHaveBeenCalled();
  expect(JSON.stringify(metadata)).not.toContain('same-human');
  expect(JSON.stringify(metadata)).not.toContain('sections');
});

it('can explicitly compare edge challenge metadata and real internal authorization with the identical human token', async () => {
  const token = await mint();
  const realFetch = globalThis.fetch;
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    expect(new Headers(init?.headers).get('authorization') === `Bearer ${token}`).toBe(true);
    if (url.origin === canonical.origin) {
      return new Response('<html>challenge fixture</html>', {
        status: 403,
        headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' },
      });
    }
    return realFetch(input, init);
  });
  expect(
    await probeLandingPageEditor(
      `${canonical.origin}/api`,
      async () => getLandingPageAiToken(envSet, `Bearer ${token}`, 'same-human'),
      true
    )
  ).toEqual({
    editorStatus: 200,
    editorApplicationJson: true,
    editorChallenge: false,
    editorUsesInternalTransport: true,
    publicEditorStatus: 403,
    publicEditorApplicationJson: false,
    publicEditorChallenge: true,
  });
  expect(provider).not.toHaveBeenCalled();
  expect(query).not.toHaveBeenCalled();
});

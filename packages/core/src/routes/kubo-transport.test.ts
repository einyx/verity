/* eslint-disable unicorn/no-await-expression-member -- Proof payload assertions stay next to the request under test. */
import { createHash } from 'node:crypto';

import { decodeProtectedHeader, jwtVerify } from 'jose';

import { createContextWithRouteParameters } from '#src/utils/test-utils.js';

import { requestKubo } from './kubo-transport.js';
import type { ManagementApiRouterContext } from './types.js';

const { jest } = import.meta;
// Public deterministic bytes 0..31, generated at runtime: not a stored credential.
// Claims/body/header match Kubo's public Go vector. The signature digest is independently
// calculated by Go crypto/hmac over that vector's exact header/payload with these bytes.
const key = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
const fixture = {
  now: 1_700_000_010,
  method: 'PATCH',
  path: '/api/stacks/%64emo/product?preview=%2F+%20&x=%252F',
  body: '{"featureFlags":{"demo_flag":"true"}}',
  claims: {
    iss: 'verity-console',
    aud: 'kubo-portal',
    sub: 'actor-a',
    tenantId: 'tenant-a',
    operator: false,
    method: 'PATCH',
    path: '/api/stacks/%64emo/product?preview=%2F+%20&x=%252F',
    bodySha256: '1538b65f9e0ad9fe04cb04e0fa9073b18c079f2df1dc0d1e1b91e2d9aa03b903',
    iat: 1_700_000_000,
    exp: 1_700_000_030,
  },
  signatureSha256: '46ed8f79a9b652f6d475cfd5974f554409698f0f0fd895e5823ec6c7b1b0547d',
};
const access = { tenantId: 'tenant-a', actorId: 'actor-a', operator: true, canViewAll: true };

const context = () =>
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Only auth and set are used; unrelated audit hooks are not exercised.
  ({
    ...createContextWithRouteParameters(),
    auth: { id: 'actor-a', type: 'user', scopes: new Set() },
  }) as ManagementApiRouterContext;
const proofFrom = (init?: RequestInit) =>
  new Headers(init?.headers).get('X-Kubo-Console-Context') ?? '';

afterEach(() => {
  jest.restoreAllMocks();
  Reflect.deleteProperty(process.env, 'KUBO_CONSOLE_PROXY_KEY');
});
beforeEach(() => {
  process.env.KUBO_CONSOLE_PROXY_KEY = key.toString('base64');
});

it('emits generated public proof with pinned claims, header and independently Go-checked signature digest', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(fixture.claims.iat * 1000);
  const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
  await requestKubo(
    context(),
    { ...access, operator: false },
    { path: fixture.path, method: fixture.method, body: fixture.body }
  );
  const proof = proofFrom(fetchSpy.mock.calls[0]?.[1]);
  expect(decodeProtectedHeader(proof)).toEqual({ alg: 'HS256', typ: 'JWT' });
  const { payload } = await jwtVerify(proof, key, {
    algorithms: ['HS256'],
    currentDate: new Date(fixture.now * 1000),
    issuer: 'verity-console',
    audience: 'kubo-portal',
  });
  expect(payload).toEqual(fixture.claims);
  const signature = Buffer.from(proof.split('.')[2] ?? '', 'base64url');
  expect(createHash('sha256').update(signature).digest('hex')).toBe(fixture.signatureSha256);
});

it.each(['/api/stacks?', '/api/template?x=%2F+%20&x=%252F'])(
  'binds exact final encoded URI %s and empty-body hash',
  async (path) => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    await requestKubo(context(), access, { path });
    const { payload } = await jwtVerify(proofFrom(fetchSpy.mock.calls[0]?.[1]), key);
    expect(payload).toMatchObject({
      method: 'GET',
      path,
      bodySha256: createHash('sha256').update('').digest('hex'),
    });
  }
);

it.each([
  '/api/unknown',
  '//evil.example/api/stacks',
  'https://evil.example/api/stacks',
  '/api/stacks/../unknown',
  '/api/backups',
])('refuses unsupported tenant path %s', async (path) => {
  const fetchSpy = jest.spyOn(globalThis, 'fetch');
  await expect(
    requestKubo(context(), { ...access, operator: false }, { path })
  ).rejects.toMatchObject({ status: 403 });
  expect(fetchSpy).not.toHaveBeenCalled();
});

it.each(['', 'malformed!', Buffer.from('short').toString('base64')])(
  'fails closed for bad key %s',
  async (encoded) => {
    process.env.KUBO_CONSOLE_PROXY_KEY = encoded;
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    await expect(requestKubo(context(), access, { path: '/api/stacks' })).rejects.toMatchObject({
      status: 503,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  }
);

it('binds exact serialized JSON and bounds writes', async () => {
  const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
  const body = '{"tenant":"namespace-slug","exclude":["a"]}';
  await requestKubo(context(), access, { path: '/api/stacks', method: 'POST', body });
  expect((await jwtVerify(proofFrom(fetchSpy.mock.calls[0]?.[1]), key)).payload.bodySha256).toBe(
    createHash('sha256').update(body).digest('hex')
  );
  await expect(
    requestKubo(context(), access, {
      path: '/api/stacks',
      method: 'POST',
      body: 'x'.repeat(1024 * 1024 + 1),
    })
  ).rejects.toMatchObject({ status: 413 });
});

it('permits UNSIGNED-PAYLOAD only for operator streaming airgap', async () => {
  const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
  const body = new ReadableStream();
  await expect(
    requestKubo(
      context(),
      { ...access, operator: false },
      { path: '/api/airgap/bundle', method: 'POST', body }
    )
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    requestKubo(context(), access, { path: '/api/stacks', method: 'POST', body })
  ).rejects.toMatchObject({ status: 403 });
  await requestKubo(context(), access, {
    path: '/api/airgap/bundle?name=demo',
    method: 'POST',
    body,
  });
  expect((await jwtVerify(proofFrom(fetchSpy.mock.calls[0]?.[1]), key)).payload.bodySha256).toBe(
    'UNSIGNED-PAYLOAD'
  );
});
/* eslint-enable unicorn/no-await-expression-member */

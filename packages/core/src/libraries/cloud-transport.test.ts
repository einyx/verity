const { jest } = import.meta;
const canonical = new URL('https://console.meshx.foundation');
const values = {
  isCloud: true,
  cloudUrlSet: { endpoint: canonical },
  adminUrlSet: { endpoint: canonical },
  urlSet: { localhostUrl: new URL('http://127.0.0.1:3001') },
};
jest.unstable_mockModule('#src/env-set/index.js', () => ({ EnvSet: { values } }));
const { createCloudApiFetch } = await import('./cloud-transport.js');
beforeEach(() => {
  jest.replaceProperty(process, 'env', { ...process.env, CLOUD_INTERNAL_TRANSPORT: 'true' });
});
afterEach(() => {
  jest.restoreAllMocks();
});

it('retains the human credential and body, but overwrites untrusted canonical routing headers', async () => {
  const fetchImpl = jest
    .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    .mockResolvedValue(new Response('{}'));
  await createCloudApiFetch(fetchImpl)(new URL('/api/landing-page/draft?revision=1', canonical), {
    method: 'PUT',
    body: '{"synthetic":true}',
    headers: {
      authorization: 'Bearer synthetic-human',
      host: 'untrusted.example',
      forwarded: 'untrusted',
      'x-forwarded-host': 'untrusted.example',
      'x-forwarded-proto': 'http',
      'x-forwarded-for': 'untrusted',
      'x-forwarded-next': 'untrusted',
      'x-forwarded-user': 'untrusted',
    },
  });
  expect(fetchImpl.mock.calls[0]?.[0]).toBe(
    'http://127.0.0.1:3001/api/landing-page/draft?revision=1'
  );
  expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
    method: 'PUT',
    body: '{"synthetic":true}',
    redirect: 'error',
    headers: {
      authorization: 'Bearer synthetic-human',
      host: canonical.host,
      'x-forwarded-host': canonical.host,
      'x-forwarded-proto': 'https',
    },
  });
  expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).has('forwarded')).toBe(false);
  expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).has('x-forwarded-for')).toBe(false);
  expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).has('x-forwarded-next')).toBe(false);
  expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).has('x-forwarded-user')).toBe(false);
});

it('supports Request input without dropping a POST body or credentials', async () => {
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    expect(request.url).toBe('http://127.0.0.1:3001/api/landing-page/ai-edit');
    expect(request.method).toBe('POST');
    expect(await request.text()).toBe('{"synthetic":true}');
    expect(request.headers.get('authorization') === 'Bearer synthetic-human').toBe(true);
    return new Response('{}');
  };
  await createCloudApiFetch(fetchImpl)(
    new Request(new URL('/api/landing-page/ai-edit', canonical), {
      method: 'POST',
      body: '{"synthetic":true}',
      headers: { authorization: 'Bearer synthetic-human' },
    })
  );
});

it('honors native Request init overrides instead of retaining a replaced credential', async () => {
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    expect(request.headers.has('authorization')).toBe(false);
    expect(request.method).toBe('POST');
    expect(await request.text()).toBe('replacement-body');
    return new Response('{}');
  };
  await createCloudApiFetch(fetchImpl)(
    new Request(new URL('/api/landing-page/ai-edit', canonical), {
      method: 'POST',
      body: 'original-body',
      headers: { authorization: 'Bearer replaced-synthetic' },
    }),
    { headers: { accept: 'application/json' }, body: 'replacement-body' }
  );
});

it.each([
  'https://untrusted.example/api/landing-page/editor',
  'http://console.meshx.foundation/api/landing-page/editor',
])('rejects an unconfigured target before any credential-bearing request: %s', async (url) => {
  const fetchImpl = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
  await expect(createCloudApiFetch(fetchImpl)(url)).rejects.toThrow('co-located');
  expect(fetchImpl).not.toHaveBeenCalled();
});

it('rejects a non-loopback listener, with no external fallback', async () => {
  jest.replaceProperty(values.urlSet, 'localhostUrl', new URL('http://remote.example:3001'));
  const fetchImpl = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
  await expect(
    createCloudApiFetch(fetchImpl)(new URL('/api/landing-page/editor', canonical))
  ).rejects.toThrow('loopback');
  expect(fetchImpl).not.toHaveBeenCalled();
});

it('preserves the public endpoint when the existing opt-in is disabled', async () => {
  jest.replaceProperty(process, 'env', { ...process.env, CLOUD_INTERNAL_TRANSPORT: 'false' });
  const fetchImpl = jest
    .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    .mockResolvedValue(new Response('{}'));
  await createCloudApiFetch(fetchImpl)(new URL('/api/landing-page/editor', canonical), {
    headers: {
      host: 'untrusted.example',
      'x-forwarded-host': 'untrusted.example',
      forwarded: 'untrusted',
    },
  });
  expect(fetchImpl.mock.calls[0]?.[0]).toBe(`${canonical.origin}/api/landing-page/editor`);
  expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).has('x-forwarded-host')).toBe(false);
  expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).has('host')).toBe(false);
  expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).has('forwarded')).toBe(false);
});

import type { LookupAddress } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { PassThrough } from 'node:stream';
import { gzipSync } from 'node:zlib';

import { readBoundedResponse } from './bounded-response.js';
import {
  createCompanyLookup,
  createCompanyPageFetch,
  isPublicCompanyAddress,
} from './landing-page-company-transport.js';

const { jest } = import.meta;
const resolve = async (lookup: LookupFunction, all = false) =>
  new Promise<string | LookupAddress[]>((_resolve, reject) => {
    lookup('company.example', { all }, (error, addresses) => {
      if (error) {
        reject(error);
      } else {
        _resolve(addresses);
      }
    });
  });

it.each([
  '127.0.0.1',
  '10.0.0.1',
  '169.254.169.254',
  '100.64.1.1',
  '192.168.1.1',
  '0.0.0.0',
  '198.18.0.1',
  '203.0.113.1',
  '224.0.0.1',
  '240.0.0.1',
  '::',
  '::1',
  'fd00::1',
  'fe80::1',
  'ff02::1',
  '::ffff:127.0.0.1',
  '::ffff:7f00:1',
  '0:0:0:0:0:ffff:a00:1',
  '2001:db8::1',
  'not-an-ip',
])('rejects non-public or mapped private peer %s', async (address) => {
  expect(isPublicCompanyAddress(address)).toBe(false);
  await expect(
    resolve(createCompanyLookup(async () => [{ address, family: address.includes(':') ? 6 : 4 }]))
  ).rejects.toThrow();
});

it('selects only validated connected addresses, and rejects a rebinding/mixed answer on the next connection', async () => {
  const answers = jest
    .fn()
    .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
    .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
  const lookup = createCompanyLookup(answers);
  await expect(resolve(lookup, true)).resolves.toEqual([{ address: '93.184.216.34', family: 4 }]);
  await expect(resolve(lookup)).rejects.toThrow();
  await expect(
    resolve(
      createCompanyLookup(async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '::ffff:7f00:1', family: 6 },
      ])
    )
  ).rejects.toThrow();
  expect(isPublicCompanyAddress('::ffff:5db8:d822')).toBe(true);
  expect(isPublicCompanyAddress('2606:4700:4700::1111')).toBe(true);
});

it('uses Got socket DNS selection with original TLS hostname, no redirects/retry/proxy pool', async () => {
  const stream = new PassThrough();
  const request = jest.fn(() => stream);
  const fetchPage = createCompanyPageFetch({
    request,
    resolve: async () => [{ address: '93.184.216.34', family: 4 }],
  });
  const pending = fetchPage('https://company.example/about', {
    redirect: 'manual',
    signal: new AbortController().signal,
  });
  expect(request.mock.calls[0]).toBeDefined();
  // Inspect injected transport arguments, not a live socket/network.
  const call = request.mock.calls[0] as unknown as [URL, { dnsLookup: LookupFunction }];
  expect(call[0].hostname).toBe('company.example');
  expect(call[1]).toMatchObject({
    followRedirect: false,
    retry: { limit: 0 },
    dnsCache: false,
    decompress: true,
    http2: false,
    agent: { https: false },
  });
  await expect(resolve(call[1].dnsLookup)).resolves.toBe('93.184.216.34');
  stream.emit('response', { statusCode: 302 });
  const response = await pending;
  expect(response.status).toBe(302);
  expect(stream.destroyed).toBe(true);
  expect(request).toHaveBeenCalledTimes(1);
});

it.each([
  'http://company.example',
  'https://user:pass@company.example',
  'https://127.0.0.1',
  'https://[::ffff:7f00:1]',
])('refuses invalid destinations before transport: %s', async (url) => {
  const request = jest.fn(() => new PassThrough());
  await expect(
    createCompanyPageFetch({ request })(url, {
      redirect: 'manual',
      signal: new AbortController().signal,
    })
  ).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});

it('bounds decompressed bytes, not the small compressed content length', async () => {
  const compressed = gzipSync('x'.repeat(500_000));
  const decoded = new Response(
    new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')),
    { headers: { 'content-length': String(compressed.length) } }
  );
  await expect(readBoundedResponse(decoded, { maxBytes: 200_000 })).rejects.toThrow(
    'Response too large'
  );
});

it.each([204, 205])(
  'handles no-body HTTP %s without throwing from a transport event',
  async (statusCode) => {
    const stream = new PassThrough();
    const pending = createCompanyPageFetch({ request: () => stream })('https://company.example/', {
      redirect: 'manual',
      signal: new AbortController().signal,
    });
    expect(() => stream.emit('response', { statusCode })).not.toThrow();
    const response = await pending;
    expect(response.status).toBe(statusCode);
    expect(stream.destroyed).toBe(true);
  }
);

it.each([101, 600, 999])(
  'rejects unsupported upstream status %s without an uncaught event error',
  async (statusCode) => {
    const stream = new PassThrough();
    const pending = createCompanyPageFetch({ request: () => stream })('https://company.example/', {
      redirect: 'manual',
      signal: new AbortController().signal,
    });
    expect(() => stream.emit('response', { statusCode })).not.toThrow();
    await expect(pending).rejects.toThrow('Invalid company response status');
    expect(stream.destroyed).toBe(true);
  }
);

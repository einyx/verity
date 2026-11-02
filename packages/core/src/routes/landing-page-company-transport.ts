import type { LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import type { IncomingMessage } from 'node:http';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { Readable } from 'node:stream';

import { got, type OptionsInit } from 'got';

const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const) {
  blocked.addSubnet(address, prefix, 'ipv4');
}
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
for (const [address, prefix] of [
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
] as const) {
  blocked.addSubnet(address, prefix, 'ipv6');
}

export const isPublicCompanyAddress = (address: string): boolean => {
  const family = isIP(address);
  if (family === 4) {
    return !blocked.check(address, 'ipv4');
  }
  if (family !== 6 || address.includes('%')) {
    return false;
  }
  // URL canonicalization covers dotted, hex and expanded IPv4-mapped IPv6 spellings.
  const normalized = new URL(`http://[${address}]`).hostname.slice(1, -1);
  const mapped = /^::ffff:([\da-f]+):([\da-f]+)$/u.exec(normalized);
  if (mapped?.[1] && mapped[2]) {
    const high = Number.parseInt(mapped[1], 16);
    const low = Number.parseInt(mapped[2], 16);
    return isPublicCompanyAddress(
      `${Math.floor(high / 256)}.${high % 256}.${Math.floor(low / 256)}.${low % 256}`
    );
  }
  return globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
};

type CompanyResolver = (hostname: string) => Promise<LookupAddress[]>;
const resolvePublic: CompanyResolver = async (hostname) => lookup(hostname, { all: true });

/** This is the actual socket lookup, not a check followed by a second uncontrolled lookup. */
export const createCompanyLookup =
  (resolve: CompanyResolver = resolvePublic): LookupFunction =>
  (hostname, options, callback) => {
    // eslint-disable-next-line promise/prefer-await-to-then -- Adapt async resolution to Node's socket lookup callback.
    void resolve(hostname).then(
      (addresses) => {
        if (
          addresses.length === 0 ||
          addresses.some(({ address }) => !isPublicCompanyAddress(address))
        ) {
          callback(new Error('Non-public company address'), '');
          return;
        }
        const selected = addresses.filter(
          ({ family }) => !options.family || family === options.family
        );
        const first = selected[0];
        if (!first) {
          callback(new Error('No usable company address'), '');
          return;
        }
        callback(null, options.all ? selected : first.address, first.family);
      },
      () => {
        callback(new Error('Company resolution failed'), '');
      }
    );
  };

export type CompanyPageFetch = (
  url: string,
  init: { redirect: 'manual'; signal: AbortSignal }
) => Promise<Response>;
type Transport = (url: URL, options: OptionsInit & { isStream?: true }) => Readable;

/** Got's documented stream + dnsLookup transport preserves hostname TLS/SNI while pinning peers. */
export const createCompanyPageFetch =
  ({
    resolve,
    request = (url, options) => got.stream(url, options),
  }: {
    resolve?: CompanyResolver;
    request?: Transport;
  } = {}): CompanyPageFetch =>
  async (input, { signal }) => {
    const url = new URL(input);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      isIP(url.hostname.replaceAll('[', '').replaceAll(']', ''))
    ) {
      throw new Error('Invalid company URL');
    }
    signal.throwIfAborted();
    const stream = request(url, {
      dnsLookup: createCompanyLookup(resolve),
      dnsCache: false,
      followRedirect: false,
      retry: { limit: 0 },
      throwHttpErrors: false,
      decompress: true,
      http2: false,
      agent: { https: false },
      timeout: { request: 5000 },
      signal,
    });
    // eslint-disable-next-line promise/param-names -- Avoid shadowing the injected DNS resolver.
    return new Promise<Response>((resolveResponse, reject) => {
      stream.once('error', reject);
      stream.once('response', (incoming: IncomingMessage) => {
        const status = incoming.statusCode ?? 502;
        if (!Number.isInteger(status) || status < 200 || status > 599) {
          stream.destroy();
          reject(new Error('Invalid company response status'));
          return;
        }
        if (status < 200 || status >= 300 || status === 204 || status === 205) {
          stream.destroy();
          resolveResponse(new Response(null, { status }));
          return;
        }
        resolveResponse(
          // eslint-disable-next-line no-restricted-syntax -- Node's toWeb type is broader than its byte-stream runtime output.
          new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status })
        );
      });
    });
  };

export const resolvesToPublicAddress = async (domain: string): Promise<boolean> => {
  try {
    const addresses = await resolvePublic(domain);
    return (
      addresses.length > 0 && addresses.every(({ address }) => isPublicCompanyAddress(address))
    );
  } catch {
    return false;
  }
};

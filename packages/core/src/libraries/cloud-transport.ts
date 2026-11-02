import { EnvSet } from '#src/env-set/index.js';

/** Existing opt-in co-located transport. Canonical public issuers and audiences never change. */
export const getCloudTransport = (
  endpoint: string
): { endpoint: string; headers: Record<string, string> } => {
  const canonical = new URL(endpoint);
  const { isCloud, urlSet, cloudUrlSet, adminUrlSet } = EnvSet.values;
  if (process.env.CLOUD_INTERNAL_TRANSPORT !== 'true') {
    return { endpoint, headers: {} };
  }
  if (
    !isCloud ||
    cloudUrlSet.endpoint.origin !== adminUrlSet.endpoint.origin ||
    canonical.origin !== adminUrlSet.endpoint.origin ||
    !['localhost', '127.0.0.1', '[::1]'].includes(urlSet.localhostUrl.hostname)
  ) {
    throw new Error(
      'Internal Cloud transport requires co-located Cloud endpoints and a loopback listener'
    );
  }
  return {
    endpoint: new URL(
      `${urlSet.localhostUrl.origin}${canonical.pathname}${canonical.search}`
    ).toString(),
    headers: {
      host: canonical.host,
      'x-forwarded-host': canonical.host,
      'x-forwarded-proto': canonical.protocol.slice(0, -1),
    },
  };
};

/** Preserve the caller's credential; only server-configured routing headers may select the tenant. */
export const createCloudApiFetch =
  (fetchImpl: typeof fetch = fetch): typeof fetch =>
  async (input, init) => {
    const request = input instanceof Request ? new Request(input, init) : undefined;
    const canonical = request ? request.url : String(input);
    const transport = getCloudTransport(canonical);
    const headers = new Headers(request?.headers ?? init?.headers);
    const routingHeaders = [...headers.keys()].filter(
      (name) => name === 'host' || name === 'forwarded' || name.startsWith('x-forwarded-')
    );
    for (const name of routingHeaders) {
      headers.delete(name);
    }
    for (const [name, value] of Object.entries(transport.headers)) {
      headers.set(name, value);
    }
    return fetchImpl(request ? new Request(transport.endpoint, request) : transport.endpoint, {
      ...(request ? {} : init),
      headers: Object.fromEntries(headers),
      // Never follow a public challenge/redirect or silently fall back to the public edge.
      redirect: 'error',
    });
  };

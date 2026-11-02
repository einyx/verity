import type { ClientRequest, IncomingHttpHeaders } from 'node:http';

const hopByHop = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/** Only server-derived canonical routing headers may reach the internal listener. */
export const setInternalProxyHeaders = (
  request: ClientRequest,
  incoming: IncomingHttpHeaders,
  endpoint: URL
) => {
  const connectionHeaders = new Set(
    (incoming.connection ?? '').split(',').map((name) => name.trim().toLowerCase())
  );

  for (const name of Object.keys(incoming)) {
    if (
      name === 'forwarded' ||
      name.startsWith('x-forwarded-') ||
      hopByHop.has(name) ||
      connectionHeaders.has(name)
    ) {
      request.removeHeader(name);
    }
  }

  request.setHeader('host', endpoint.host);
  request.setHeader('x-forwarded-host', endpoint.host);
  request.setHeader('x-forwarded-proto', endpoint.protocol.slice(0, -1));
};

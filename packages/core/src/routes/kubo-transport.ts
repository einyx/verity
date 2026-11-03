import { createHash } from 'node:crypto';

import { SignJWT } from 'jose';

import RequestError from '#src/errors/RequestError/index.js';
import assertThat from '#src/utils/assert-that.js';

import type { KuboAccess } from './kubo-access.js';
import { kuboPortalUrl } from './kubo-portal-url.js';
import type { ManagementApiRouterContext } from './types.js';

const unavailable = () => new RequestError({ code: 'auth.forbidden', status: 503 });
const forbidden = () => new RequestError({ code: 'auth.forbidden', status: 403 });

const signingKey = () => {
  const encoded = process.env.KUBO_CONSOLE_PROXY_KEY ?? '';
  const key = Buffer.from(encoded, 'base64');
  assertThat(
    encoded.length > 0 && key.length >= 32 && key.toString('base64') === encoded,
    unavailable()
  );
  return key;
};

/** Only known tenant surfaces may carry a tenant delegation; new control routes default closed. */
const tenantPathAllowed = (method: string, path: string) => {
  const pathname = decodeURIComponent(new URL(path, 'http://kubo.invalid').pathname);
  if (method === 'GET' && path === '/api/console/readiness') {
    return true;
  }
  // The capacity map is a cluster-wide read, not a tenant-scoped one: it shows the shared
  // nodes and the workloads placed on them, so every tenant may read it.
  if (
    method === 'GET' &&
    ['/api/stacks', '/api/templates', '/api/template', '/api/kshows/snapshot'].includes(pathname)
  ) {
    return true;
  }
  if (method === 'POST' && pathname === '/api/stacks') {
    return true;
  }
  return /^\/api\/stacks(?:\/[\da-z-]+){2}$/.test(pathname)
    ? ['GET', 'PATCH', 'DELETE'].includes(method)
    : method === 'POST' &&
        /^\/api\/stacks(?:\/[\da-z-]+){2}\/(bo{2}tstrap|pause|reconcile)$/.test(pathname);
};

type KuboRequest = { path: string; method?: string; body?: string | BodyInit };

const prepareRequest = (access: KuboAccess, { path, method = 'GET', body }: KuboRequest) => {
  // Never resolve an absolute/external URL, nor sign a fragment that HTTP would not transmit.
  assertThat(path.startsWith('/') && !path.startsWith('//') && !/[#\\]/.test(path), forbidden());
  const url = new URL(path, kuboPortalUrl());
  assertThat(access.operator || tenantPathAllowed(method, path), forbidden());
  const streaming = body !== undefined && typeof body !== 'string';
  const textBody = typeof body === 'string' ? body : '';
  assertThat(
    !streaming || (access.operator && method === 'POST' && url.pathname === '/api/airgap/bundle'),
    forbidden()
  );
  return { url, method, body, streaming, textBody };
};

const signRequest = async (access: KuboAccess, request: ReturnType<typeof prepareRequest>) => {
  const { url, method, streaming, textBody } = request;
  assertThat(
    streaming || Buffer.byteLength(textBody) <= 1024 * 1024,
    new RequestError({ code: 'auth.forbidden', status: 413 })
  );
  const now = Math.floor(Date.now() / 1000);
  // Href preserves an explicit empty '?', unlike URL.search.
  const encodedPath = url.href.slice(url.origin.length);
  return new SignJWT({
    iss: 'verity-console',
    aud: 'kubo-portal',
    sub: access.actorId,
    tenantId: access.tenantId,
    operator: access.operator,
    method,
    path: encodedPath,
    bodySha256: streaming
      ? 'UNSIGNED-PAYLOAD'
      : createHash('sha256').update(textBody).digest('hex'),
    iat: now,
    exp: now + 30,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .sign(signingKey());
};

export const requestKubo = async (
  ctx: ManagementApiRouterContext,
  access: KuboAccess,
  request: KuboRequest
): Promise<Response> => {
  ctx.set('Cache-Control', 'private, no-store');
  const prepared = prepareRequest(access, request);
  const { url, method, body, streaming } = prepared;
  assertThat(method === 'GET' || !ctx.auth.isReadOnly, forbidden());
  const proof = await signRequest(access, prepared);
  try {
    return await fetch(url, {
      method,
      redirect: 'error',
      headers: {
        accept: 'application/json',
        'X-Kubo-Console-Context': proof,
        ...(body === undefined
          ? {}
          : { 'content-type': streaming ? 'application/x-tar' : 'application/json' }),
      },
      ...(body === undefined ? {} : { body }),
      ...(streaming ? { duplex: 'half' } : {}),
      signal: AbortSignal.timeout(streaming ? 60 * 60 * 1000 : 30_000),
    });
  } catch {
    // Do not attach fetch errors: they can include URLs, credentials or response diagnostics.
    throw new RequestError({ code: 'auth.forbidden', status: 502 });
  }
};

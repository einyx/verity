import { text } from 'node:stream/consumers';

import { createOrganizationLookup, grantedOrganizations, portalHomeData } from '@logto/mcp-portal';

import { EnvSet } from '#src/env-set/index.js';

import { mcpPortalHomeClientId, mcpPortalHomePageHtml } from './mcp-portal-home-page.js';
import { audit, type McpPortalStores, storesFor } from './mcp-portal-shared.js';
import type { AnonymousRouter, RouterInitArgs } from './types.js';

// The MCP portal home page: the human surface of a portal host. A visitor sees the portal's name
// and a sign-in button only; the servers and connect commands appear after an OIDC sign-in, for
// callers whose organizations the portal grants. The MCP protocol endpoint stays in
// mcp-portal-endpoint.ts; this page never serves MCP clients.

export { mcpPortalHomeClientId } from './mcp-portal-home-page.js';

type McpPortalHomeDeps = {
  /** The stores for this request. Production reads the database; tests pass fakes. */
  load: () => Promise<McpPortalStores>;
  /** Logto's OIDC issuer, for the organization lookup and the code exchange. */
  issuer: () => string;
  /** Whether the page is served. Guards the portal home page dev feature. */
  enabled?: () => boolean;
  /** Token exchange fetch, injectable for tests. */
  fetchImpl?: typeof fetch;
  /** Resolves the lookup for an issuer. Tests pass a fake; production caches per issuer. */
  lookupFor?: (issuer: string) => (accessToken: string) => Promise<string[]>;
};

const hostnameOf = (host: string | undefined) => (host ?? '').split(':')[0] ?? '';

const redirectUriFor = (hostname: string) => `https://${hostname}/callback`;

// One lookup per issuer, so its answers are cached across requests. Mirrors the protocol endpoint.
const lookupByIssuer = new Map<string, (accessToken: string) => Promise<string[]>>();

const organizationLookupFor = (issuer: string) => {
  const cached = lookupByIssuer.get(issuer);

  if (cached) {
    return cached;
  }

  const lookup = createOrganizationLookup({ issuer });
  lookupByIssuer.set(issuer, lookup);

  return lookup;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** The parsed exchange body, or undefined when it does not carry a code and a verifier. */
const parseExchangeBody = (raw: string): { code: string; codeVerifier: string } | undefined => {
  try {
    const body: unknown = raw ? JSON.parse(raw) : undefined;

    if (!isRecord(body)) {
      return;
    }

    const { code, codeVerifier } = body;

    return typeof code === 'string' &&
      code.length > 0 &&
      typeof codeVerifier === 'string' &&
      codeVerifier.length > 0
      ? { code, codeVerifier }
      : undefined;
  } catch {}
};

/**
 * Registers the portal home page routes on the anonymous router. Every route is keyed by the
 * request's hostname: a host with no portal falls through to the routes below (the MCP protocol
 * endpoint, then the tenant's own apps).
 */
export const registerMcpPortalHomeRoutes = <T extends AnonymousRouter>(
  router: T,
  { load, issuer, enabled, fetchImpl = fetch, lookupFor = organizationLookupFor }: McpPortalHomeDeps
) => {
  const isEnabled = enabled ?? (() => EnvSet.values.isDevFeaturesEnabled);

  const portalFor = async (ctx: { host: string | undefined }) => {
    if (!isEnabled()) {
      return;
    }

    const { portals } = await load();

    return portals.findByHostname(hostnameOf(ctx.host));
  };

  router.get(['/', '/callback'], async (ctx, next) => {
    const portal = await portalFor(ctx);

    if (!portal) {
      return next();
    }

    ctx.type = 'text/html; charset=utf-8';
    ctx.set('Cache-Control', 'no-store');
    ctx.body = mcpPortalHomePageHtml({ issuer: issuer(), portalName: portal.name });
  });

  router.post('/callback/exchange', async (ctx, next) => {
    const portal = await portalFor(ctx);

    if (!portal) {
      return next();
    }

    const body = parseExchangeBody(await text(ctx.req));

    if (!body) {
      ctx.status = 400;
      ctx.body = { error: 'Expected { code, codeVerifier }' };
      return;
    }

    // The redirect URI is the caller's own portal host, so the code can only be redeemed by the
    // page the issuer redirected to.
    const response = await fetchImpl(`${issuer().replace(/\/$/, '')}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: mcpPortalHomeClientId,
        code: body.code,
        code_verifier: body.codeVerifier,
        redirect_uri: redirectUriFor(hostnameOf(ctx.host)),
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      ctx.status = 400;
      ctx.body = { error: 'The sign-in code was refused' };
      return;
    }

    const tokens: unknown = await response.json();
    ctx.set('Cache-Control', 'no-store');
    ctx.body = tokens;
  });

  router.get('/mcp-home', async (ctx, next) => {
    const portal = await portalFor(ctx);

    if (!portal) {
      return next();
    }

    const token = ctx.get('authorization').replace(/^bearer\s+/i, '');

    if (!token) {
      ctx.status = 401;
      ctx.set('www-authenticate', 'Bearer');
      ctx.body = { error: 'Missing bearer token' };
      return;
    }

    const granted = await grantedOrganizations({
      portal,
      token,
      caller: { sub: mcpPortalHomeClientId, scopes: [] },
      lookup: lookupFor(issuer()),
      // Home-page access rides the same audit trail as the protocol endpoint.
      audit,
      logError: (line: string) => {
        process.stderr.write(`${line}\n`);
      },
    });

    if (!granted) {
      ctx.status = 403;
      ctx.body = { error: 'This portal is not open to your organizations' };
      return;
    }

    const { upstreams } = await load();

    ctx.set('Cache-Control', 'no-store');
    ctx.body = portalHomeData(portal, await upstreams.listForPortal(portal.id), granted);
  });
};

export default function mcpPortalHomeRoutes<T extends AnonymousRouter>(
  ...[router, tenant]: RouterInitArgs<T>
) {
  registerMcpPortalHomeRoutes(router, {
    load: async () => storesFor(tenant.envSet.pool),
    issuer: () => tenant.envSet.oidc.issuer,
  });
}

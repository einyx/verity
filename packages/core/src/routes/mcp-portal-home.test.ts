import Koa from 'koa';
import Router from 'koa-router';
import Sinon from 'sinon';
import request from 'supertest';

import { mcpPortalHomeClientId } from './mcp-portal-home-page.js';
import { registerMcpPortalHomeRoutes } from './mcp-portal-home.js';
import { type McpPortalStores } from './mcp-portal-shared.js';
import { type AnonymousRouter } from './types.js';

/**
 * Covers the portal home page in src/routes/mcp-portal-home.ts. The stores, organization lookup,
 * and code-exchange fetch are fakes; the routes are the system under test.
 */

const portal = {
  id: 'portal-1',
  name: 'Team',
  hostname: 'mcp.example.com',
  createdAt: new Date(0).toISOString(),
  organizationIds: ['org-a'],
};

const upstreams = [
  {
    name: 'github',
    url: 'https://upstream.example/mcp',
    portalId: 'portal-1',
    createdAt: new Date(0).toISOString(),
    enabled: true,
    disabledTools: [],
    organizationIds: [],
    hasCredential: false,
  },
  {
    name: 'partner-only',
    url: 'https://partner.example/mcp',
    portalId: 'portal-1',
    createdAt: new Date(0).toISOString(),
    enabled: true,
    disabledTools: [],
    organizationIds: ['org-b'],
    hasCredential: false,
  },
  {
    name: 'switched-off',
    url: 'https://off.example/mcp',
    portalId: 'portal-1',
    createdAt: new Date(0).toISOString(),
    enabled: false,
    disabledTools: [],
    organizationIds: [],
    hasCredential: false,
  },
];

const issuer = 'https://auth.example.com/oidc';

const grantedToken = 'token-granted';
const outsiderToken = 'token-outsider';

/** Stands in for the userinfo lookup: organizations by token. */
const lookupByToken = async (token: string) => (token === grantedToken ? ['org-a'] : ['org-zz']);

const findByHostname = async (hostname: string) =>
  hostname === portal.hostname ? portal : undefined;

const listForPortal = async () => upstreams;

const stores = {
  portals: { findByHostname },
  upstreams: { listForPortal },
} as unknown as McpPortalStores;

const createApp = ({ enabled = true }: { enabled?: boolean } = {}) => {
  const app = new Koa();
  const router: AnonymousRouter = new Router();
  registerMcpPortalHomeRoutes(router, {
    load: async () => stores,
    issuer: () => issuer,
    enabled: () => enabled,
    lookupFor: () => lookupByToken,
  });
  app.use(router.routes()).use(router.allowedMethods());

  return app.callback();
};

describe('mcp portal home page', () => {
  describe('GET / and /callback', () => {
    it('serves the page with the sign-in config on a portal host', async () => {
      const response = await request(createApp()).get('/').set('host', portal.hostname);

      expect(response.status).toBe(200);
      expect(response.type).toBe('text/html');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.text).toContain(portal.name);
      expect(response.text).toContain(issuer);
      expect(response.text).toContain('mcp-portal-home');
    });

    it('reveals no server names before sign-in', async () => {
      const response = await request(createApp()).get('/').set('host', portal.hostname);

      for (const { name } of upstreams) {
        expect(response.text).not.toContain(name);
      }
    });

    it('serves the same page for the callback path', async () => {
      const response = await request(createApp()).get('/callback').set('host', portal.hostname);

      expect(response.status).toBe(200);
      expect(response.type).toBe('text/html');
    });

    it('falls through on a host with no portal', async () => {
      const response = await request(createApp()).get('/').set('host', 'unknown.example.com');

      expect(response.status).toBe(404);
    });

    it('falls through when the dev feature is disabled', async () => {
      const response = await request(createApp({ enabled: false }))
        .get('/')
        .set('host', portal.hostname);

      expect(response.status).toBe(404);
    });
  });

  describe('POST /callback/exchange', () => {
    it('rejects a body without a code and verifier', async () => {
      const response = await request(createApp())
        .post('/callback/exchange')
        .set('host', portal.hostname)
        .send({ code: 'code' });

      expect(response.status).toBe(400);
    });

    it('exchanges the code at the issuer with the portal host as the redirect URI', async () => {
      // Records the exchange request without reassigning anything.
      const exchange = Sinon.fake(
        async (_url: string, _init: RequestInit) =>
          new Response(JSON.stringify({ access_token: 'token', token_type: 'Bearer' }), {
            status: 200,
          })
      );
      const app = new Koa();
      const router: AnonymousRouter = new Router();
      registerMcpPortalHomeRoutes(router, {
        load: async () => stores,
        issuer: () => issuer,
        enabled: () => true,
        lookupFor: () => lookupByToken,
        fetchImpl: exchange as unknown as typeof fetch,
      });
      app.use(router.routes()).use(router.allowedMethods());

      const response = await request(app.callback())
        .post('/callback/exchange')
        .set('host', portal.hostname)
        .send({ code: 'the-code', codeVerifier: 'the-verifier' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ access_token: 'token', token_type: 'Bearer' });

      const [url, init] = exchange.lastCall.args;
      const body = new URLSearchParams(String(init.body));

      expect(url).toBe(`${issuer}/token`);
      expect(body.get('client_id')).toBe(mcpPortalHomeClientId);
      expect(body.get('code')).toBe('the-code');
      expect(body.get('code_verifier')).toBe('the-verifier');
      expect(body.get('redirect_uri')).toBe(`https://${portal.hostname}/callback`);
      expect(String(body.get('grant_type'))).toBe('authorization_code');
    });
  });

  describe('GET /mcp-home', () => {
    it('refuses a caller without a token', async () => {
      const response = await request(createApp()).get('/mcp-home').set('host', portal.hostname);

      expect(response.status).toBe(401);
      expect(response.headers['www-authenticate']).toBe('Bearer');
    });

    it('shows the caller only the servers their organizations unlock', async () => {
      const response = await request(createApp())
        .get('/mcp-home')
        .set('host', portal.hostname)
        .set('authorization', `Bearer ${grantedToken}`);

      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body.url).toBe(`https://${portal.hostname}/mcp`);
      expect(response.body.servers).toEqual([{ name: 'github', openToAllOrganizations: true }]);
      expect(response.body.commands.claude).toContain(`https://${portal.hostname}/mcp`);
    });

    it('refuses a caller from outside the granted organizations', async () => {
      const response = await request(createApp())
        .get('/mcp-home')
        .set('host', portal.hostname)
        .set('authorization', `Bearer ${outsiderToken}`);

      expect(response.status).toBe(403);
    });

    it('falls through on a host with no portal', async () => {
      const response = await request(createApp())
        .get('/mcp-home')
        .set('host', 'unknown.example.com');

      expect(response.status).toBe(404);
    });
  });
});

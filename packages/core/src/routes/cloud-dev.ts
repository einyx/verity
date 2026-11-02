import type { IncomingMessage } from 'node:http';

import { adminTenantId, defaultTenantId } from '@logto/schemas';
import { sql } from '@silverhand/slonik';
import type { Context, Next } from 'koa';
import proxy from 'koa-proxies';

import { EnvSet, getTenantEndpoint } from '#src/env-set/index.js';
import { isBillingConfigured } from '#src/routes/billing.js';

import { handleCheckoutCreate, handleCheckoutStatus } from './cloud-dev-checkout.js';
import { routes } from './cloud-dev-data.js';
import { setInternalProxyHeaders } from './tenant-internal-transport.js';

// Local stand-in for the Cloud API, for running the admin console in cloud mode (`IS_CLOUD`) on a
// single Logto instance. The console calls these routes on its own origin. They return the same
// defaults the OSS console uses, without checking tokens, so they are served only when the instance
// is cloud and not production. Production cloud serves its own API and never reaches this code.
// When billing is configured, the billing API serves the routes it owns instead, so checkouts and
// invoices are stored in the billing database, as they are in production.

const checkoutStatusPattern = /^\/api\/checkout-session\/([^/]+)$/;

/** Routes the billing API answers. The stand-ins step aside for these when billing is configured. */
const billingOwnedPaths = [
  /^\/api\/tenants\/[^/]+\/subscription$/,
  /^\/api\/tenants\/[^/]+\/invoices$/,
  /^\/api\/tenants\/[^/]+\/invitations$/,
  /^\/api\/skus$/,
];

/** Whether the local cloud stand-ins apply to this instance. */
export const isLocalCloud = () => EnvSet.values.isCloud;

const usesSimulatedBilling = () => !EnvSet.values.isProduction && !isBillingConfigured();

/** Serves a local data route for a GET request. Returns whether one matched. */
const serveDataRoute = (ctx: Context) => {
  if (EnvSet.values.isProduction) {
    return false;
  }
  if (isBillingConfigured() && billingOwnedPaths.some((pattern) => pattern.test(ctx.path))) {
    return false;
  }

  const match =
    ctx.method === 'GET' ? routes.find(([pattern]) => pattern.test(ctx.path)) : undefined;

  if (!match) {
    return false;
  }

  ctx.body = match[1]();
  return true;
};

const getManagementTenantId = (ctx: Context) => {
  const { path } = ctx;
  if (!/^\/m\/[^/]+\/api(?:\/|$)/.test(path)) {
    ctx.throw(404, 'Management API route not found');
  }
  if (new URL(ctx.url, 'http://internal.invalid').pathname !== path || path.includes('\\')) {
    ctx.throw(400, 'Invalid management route');
  }
  const tenantId = /^\/m\/([^/]+)/.exec(path)?.[1] ?? '';
  if (!/^[\da-z][\d_a-z-]{0,62}$/.test(tenantId)) {
    ctx.throw(400, 'Invalid tenant route');
  }
  const { isDomainBasedMultiTenancy, isPathBasedMultiTenancy } = EnvSet.values;
  if (
    !isDomainBasedMultiTenancy &&
    !isPathBasedMultiTenancy &&
    tenantId !== defaultTenantId &&
    tenantId !== adminTenantId
  ) {
    ctx.throw(404, 'Tenant not found');
  }
  return tenantId;
};

/** Serves Cloud stand-ins, internal tenant Management APIs, and the account API alias. */
export const localCloudRoutes = () => {
  // Transport is the configured local listener; canonical host/scheme still select the tenant
  // through the normal routing and authentication middleware. Never contact the public edge.
  const endpoints = new WeakMap<IncomingMessage, URL>();
  const tenantProxy = proxy('/m', (_params, ctx) => {
    const target = EnvSet.values.urlSet.localhostUrl;
    const endpoint = endpoints.get(ctx.req);
    if (!endpoint) {
      return false;
    }
    return {
      target: target.origin,
      changeOrigin: true,
      rewrite: (path: string) =>
        `${endpoint.pathname.replace(/\/$/, '')}${path.replace(/^\/m\/[^/]+/, '')}`,
      events: {
        error: (_error, _request, response) => {
          if (response.headersSent) {
            response.destroy();
            return;
          }
          response.writeHead(503, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ code: 'tenant_transport_unavailable' }));
        },
        proxyReq: (proxyRequest, request) => {
          const canonical = endpoints.get(request);
          if (!canonical) {
            proxyRequest.destroy();
            return;
          }
          setInternalProxyHeaders(proxyRequest, request.headers, canonical);
        },
      },
    };
  });

  const serveTenantProxy = async (ctx: Context, next: Next) => {
    const tenantId = getManagementTenantId(ctx);
    const pool = await EnvSet.sharedPool;
    const tenant = await pool.maybeOne(sql`select id from tenants where id = ${tenantId}`);
    if (!tenant) {
      ctx.throw(404, 'Tenant not found');
    }
    endpoints.set(ctx.req, getTenantEndpoint(tenantId, EnvSet.values));
    if (typeof ctx.requestId === 'string') {
      ctx.res.setHeader('Logto-Core-Request-Id', ctx.requestId);
    }
    try {
      await tenantProxy(ctx, next);
    } catch {
      // Koa-proxies includes the original URL in abort errors; do not propagate private queries.
      ctx.throw(503, 'Internal tenant transport unavailable');
    } finally {
      endpoints.delete(ctx.req);
    }
  };

  return async (ctx: Context, next: Next) => {
    if (!isLocalCloud()) {
      return next();
    }

    if (serveDataRoute(ctx)) {
      return;
    }

    // Checkout: a real Stripe Checkout session in test mode when STRIPE_SECRET_KEY is set. The tenant
    // moves to production only after Stripe reports the session paid. Without the key, the local
    // stand-in moves the tenant without a payment.
    const stripeKey = process.env.STRIPE_SECRET_KEY;

    if (usesSimulatedBilling()) {
      if (ctx.method === 'POST' && ctx.path === '/api/checkout-session') {
        return handleCheckoutCreate(ctx, stripeKey);
      }

      const checkoutStatus = checkoutStatusPattern.exec(ctx.path);

      if (ctx.method === 'GET' && checkoutStatus?.[1]) {
        return handleCheckoutStatus(ctx, stripeKey, checkoutStatus[1]);
      }
    }

    if (ctx.path.startsWith('/m/')) {
      return serveTenantProxy(ctx, next);
    }

    // The console reads the current user through `/a`, which maps to the account API.
    if (ctx.path === '/a' || ctx.path.startsWith('/a/')) {
      ctx.path = ctx.path.replace(/^\/a/, '/api/my-account');
    }

    return next();
  };
};

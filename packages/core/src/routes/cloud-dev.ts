import type { Context, Middleware, Next } from 'koa';
import proxy from 'koa-proxies';

import { EnvSet, getTenantEndpoint } from '#src/env-set/index.js';
import { isBillingConfigured } from '#src/routes/billing.js';

import { handleCheckoutCreate, handleCheckoutStatus } from './cloud-dev-checkout.js';
import { routes } from './cloud-dev-data.js';

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

/** Serves a local data route for a GET request. Returns whether one matched. */
const serveDataRoute = (ctx: Context) => {
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

/**
 * Serves the local cloud API routes above, the tenant Management API under `/m/<tenant>`, and the
 * account API under `/a`. Other paths fall through to the normal routes.
 */
export const localCloudRoutes = () => {
  // The default tenant's Management API is served by this instance on its user endpoint.
  // Each tenant is served on its own host when the endpoint is domain-based (`http://*.host`), so the
  // proxy targets the tenant's host. Otherwise every tenant shares the endpoint.
  // Typed with koa's default Middleware: ReturnType<typeof proxy> resolves to koa-proxies' last overload, which does not match the proxy the call returns.
  const tenantProxies = new Map<string, Middleware>();
  const tenantProxyFor = (tenantId: string) => {
    const existing = tenantProxies.get(tenantId);

    if (existing) {
      return existing;
    }

    const created = proxy('/m', {
      target: getTenantEndpoint(tenantId, EnvSet.values).origin,
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/m\/[^/]+/, ''),
    });
    tenantProxies.set(tenantId, created);

    return created;
  };

  const serveTenantProxy = async (ctx: Context, next: Next, path: string) => {
    const tenantId = /^\/m\/([^/]+)/.exec(path)?.[1] ?? '';
    await tenantProxyFor(tenantId)(ctx, next);
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

    if (!isBillingConfigured()) {
      if (ctx.method === 'POST' && ctx.path === '/api/checkout-session') {
        return handleCheckoutCreate(ctx, stripeKey);
      }

      const checkoutStatus = checkoutStatusPattern.exec(ctx.path);

      if (ctx.method === 'GET' && checkoutStatus?.[1]) {
        return handleCheckoutStatus(ctx, stripeKey, checkoutStatus[1]);
      }
    }

    if (ctx.path.startsWith('/m/')) {
      return serveTenantProxy(ctx, next, ctx.path);
    }

    // The console reads the current user through `/a`, which maps to the account API.
    if (ctx.path === '/a' || ctx.path.startsWith('/a/')) {
      ctx.path = ctx.path.replace(/^\/a/, '/api/my-account');
    }

    return next();
  };
};

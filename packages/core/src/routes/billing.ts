import { getCloudApiIndicator } from '@logto/schemas';
import {
  createBillingComposer,
  createBillingHandler,
  createPgBillingStore,
  migrateBillingSchema,
  stripeWebhookPath,
} from '@meshx/cloud/routes';
import { createPool } from '@silverhand/slonik';
import { createRemoteJWKSet } from 'jose';
import type { Context, Next } from 'koa';
import { z } from 'zod';

import { EnvSet } from '#src/env-set/index.js';

const billingEnvironment = z.object({
  BILLING_DATABASE_URL: z.string().url(),
  /** Comma-separated user IDs that may call operator-only billing routes. */
  BILLING_OPERATOR_SUBS: z.string().default(''),
  STRIPE_SECRET_KEY: z.string().startsWith('sk_'),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_'),
  STRIPE_PRO_PRICE_ID: z.string().startsWith('price_'),
});

/**
 * Whether every billing setting is present. Local development serves the billing API only when it is,
 * so an instance without billing keeps the local stand-ins.
 */
export const isBillingConfigured = () => billingEnvironment.safeParse(process.env).success;

/** Paths the billing composition answers. Everything else goes on to the normal routes. */
const billingPaths = [
  /^\/api\/tenants\//,
  /^\/api\/skus$/,
  /^\/api\/invitations/,
  /^\/api\/checkout-session/,
  new RegExp(`^${stripeWebhookPath}$`),
];

/**
 * Builds the billing handler once. The issuer, audience, and return origin come from the admin
 * endpoint that core already serves, so only the billing and Stripe settings are read from the
 * environment. A missing setting fails the billing paths with a server error, not the whole app.
 */
const buildBillingHandler = async () => {
  const environment = billingEnvironment.parse(process.env);
  const adminOrigin = EnvSet.values.adminUrlSet.endpoint.origin;
  const issuer = `${adminOrigin}/oidc`;
  const pool = await createPool(environment.BILLING_DATABASE_URL);

  await migrateBillingSchema(pool);

  return createBillingHandler(
    createBillingComposer({
      store: createPgBillingStore(pool),
      auth: {
        issuer,
        audience: getCloudApiIndicator(adminOrigin),
        getKey: createRemoteJWKSet(new URL(`${issuer}/jwks`)),
        operators: environment.BILLING_OPERATOR_SUBS.split(',')
          .filter(Boolean)
          .map((sub) => ({ issuer, sub })),
      },
      checkout: {
        stripeSecretKey: environment.STRIPE_SECRET_KEY,
        priceIdBySkuId: { pro: environment.STRIPE_PRO_PRICE_ID },
        returnOrigins: [adminOrigin],
      },
      stripeSecretKey: environment.STRIPE_SECRET_KEY,
      stripeWebhookSecret: environment.STRIPE_WEBHOOK_SECRET,
    })
  );
};

/**
 * Koa middleware for the billing paths. It runs before the body parsers, because the Stripe
 * signature is checked against the exact bytes Stripe sent, and it answers on the raw response.
 */
export const billingRoutes = () => {
  const handler = buildBillingHandler();

  return async (ctx: Context, next: Next) => {
    if (!billingPaths.some((pattern) => pattern.test(ctx.path))) {
      return next();
    }

    ctx.respond = false;
    await (
      await handler
    )(ctx.req, ctx.res);
  };
};

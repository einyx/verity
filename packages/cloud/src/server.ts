import { createPool } from '@silverhand/slonik';
import createServer from '@withtyped/server';
import { createRemoteJWKSet } from 'jose';
import { z } from 'zod';

import { type CheckoutConfig } from './billing/checkout.js';
import { createPgBillingStore } from './billing/pg-store.js';
import { migrateBillingSchema } from './billing/schema.js';
import { createBillingComposer } from './billing-server.js';

const environment = z.object({
  BILLING_DATABASE_URL: z.string().url(),
  /** The OIDC issuer that signs admin tokens, for example `https://logto.example.com/oidc`. */
  BILLING_OIDC_ISSUER: z.string().url(),
  /** The audience admin tokens are issued for. */
  BILLING_AUDIENCE: z.string().url(),
  /** Comma-separated user IDs that may call operator-only routes. */
  BILLING_OPERATOR_SUBS: z.string().default(''),
  /** Comma-separated origins checkout may return to, for example `https://console.example.com`. */
  BILLING_RETURN_ORIGINS: z.string(),
  STRIPE_SECRET_KEY: z.string().startsWith('sk_'),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_'),
  STRIPE_PRO_PRICE_ID: z.string().startsWith('price_'),
  PORT: z.coerce.number().default(9001),
});

const env = environment.parse(process.env);

const pool = await createPool(env.BILLING_DATABASE_URL);
await migrateBillingSchema(pool);

const issuer = env.BILLING_OIDC_ISSUER.replace(/\/$/, '');
const checkout: CheckoutConfig = {
  stripeSecretKey: env.STRIPE_SECRET_KEY,
  priceIdBySkuId: { pro: env.STRIPE_PRO_PRICE_ID },
  returnOrigins: env.BILLING_RETURN_ORIGINS.split(',').map((origin) => origin.trim()),
};

const composer = createBillingComposer({
  store: createPgBillingStore(pool),
  auth: {
    issuer,
    audience: env.BILLING_AUDIENCE,
    getKey: createRemoteJWKSet(new URL(`${issuer}/jwks`)),
    operators: env.BILLING_OPERATOR_SUBS.split(',')
      .filter(Boolean)
      .map((sub) => ({ issuer, sub })),
  },
  checkout,
  stripeSecretKey: env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
});

await createServer({ port: env.PORT, composer }).listen();

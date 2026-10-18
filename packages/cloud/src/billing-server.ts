import { text } from 'node:stream/consumers';

import {
  compose,
  type HttpContext,
  type NextFunction,
  type RequestContext,
  withBody,
  withRequest,
} from '@withtyped/server';

import { type OperatorAuthConfig } from './billing/auth.js';
import { type CheckoutConfig } from './billing/checkout.js';
import { createBillingRouter } from './billing/router.js';
import { type BillingStore } from './billing/store.js';
import {
  createStripeSubscriptionRetriever,
  processStripeWebhook,
  type SubscriptionRetriever,
} from './billing/stripe-webhook.js';

export const stripeWebhookPath = '/api/webhooks/stripe';

/**
 * Stripe posts events to `stripeWebhookPath`. The middleware reads the raw body before the body
 * parser runs, because the signature is computed over exactly those bytes. Any other path passes
 * through to the billing routes.
 */
const stripeWebhook =
  (options: { secret: string; store: BillingStore; retrieveSubscription: SubscriptionRetriever }) =>
  async (
    context: RequestContext,
    next: NextFunction<RequestContext>,
    { request, response }: HttpContext
  ) => {
    if (context.request.url.pathname !== stripeWebhookPath || context.request.method !== 'POST') {
      return next(context);
    }

    const header = context.request.headers['stripe-signature'];
    const result = await processStripeWebhook({
      payload: await text(request),
      signature: Array.isArray(header) ? header[0] : header,
      secret: options.secret,
      store: options.store,
      nowSeconds: Math.floor(Date.now() / 1000),
      retrieveSubscription: options.retrieveSubscription,
    });

    // The webhook answers on the raw response: the router has no step that would write a result
    // for a request it did not route.
    response.writeHead(result.status, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ message: result.message }));
  };

/** The billing HTTP composition: the Stripe webhook first, then the billing routes. */
export const createBillingComposer = (options: {
  store: BillingStore;
  auth: OperatorAuthConfig;
  checkout: CheckoutConfig;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
}) => {
  const billing = createBillingRouter(options.store, options.auth, options.checkout);

  return compose(withRequest())
    .and(
      stripeWebhook({
        secret: options.stripeWebhookSecret,
        store: options.store,
        retrieveSubscription: createStripeSubscriptionRetriever(options.stripeSecretKey),
      })
    )
    .and(withBody())
    .and(billing.routes());
};

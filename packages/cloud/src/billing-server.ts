import { type IncomingMessage, type ServerResponse } from 'node:http';
import { text } from 'node:stream/consumers';

import {
  compose,
  type HttpContext,
  type NextFunction,
  RequestError,
  type RequestContext,
  withBody,
  withRequest,
} from '@withtyped/server';

import { type OperatorAuthConfig } from './billing/auth.js';
import { type CheckoutConfig } from './billing/checkout.js';
import { createCustomerRouter } from './billing/customer-router.js';
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
  const customers = createCustomerRouter(options.store, options.auth, options.checkout);

  return compose(withRequest())
    .and(
      stripeWebhook({
        secret: options.stripeWebhookSecret,
        store: options.store,
        retrieveSubscription: createStripeSubscriptionRetriever(options.stripeSecretKey),
      })
    )
    .and(withBody())
    .and(billing.routes())
    .and(customers.routes());
};

/**
 * A plain Node request handler for the billing composition. A host that runs its own HTTP server
 * mounts it on the billing paths and passes everything else on.
 */
export const createBillingHandler =
  (composer: ReturnType<typeof createBillingComposer>) =>
  async (request: IncomingMessage, response: ServerResponse) => {
    try {
      await composer({}, async (context) => writeJsonResult(response, context), {
        request,
        response,
      });
    } catch (error: unknown) {
      // A rejected request, such as a missing token, throws from the composer. The host has
      // already handed the socket to this handler, so the error must be answered here or the
      // request never ends.
      if (response.headersSent) {
        response.end();
        return;
      }

      const status = error instanceof RequestError ? error.status : 500;
      const message = error instanceof RequestError ? error.message : 'Internal server error';

      await writeJsonResult(response, { status, json: { message } });
    }
  };

/** Writes the billing result: its status and JSON body. Billing answers only with JSON or nothing. */
const writeJsonResult = async (
  response: ServerResponse,
  context: { status?: number | 'ignore'; json?: unknown }
) => {
  const status = context.status === 'ignore' ? response.statusCode : (context.status ?? 404);

  if (context.json === undefined) {
    response.writeHead(status);
    response.end();
    return;
  }

  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(context.json));
};

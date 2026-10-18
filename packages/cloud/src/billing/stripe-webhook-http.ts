import { type IncomingMessage, type ServerResponse } from 'node:http';
import { text } from 'node:stream/consumers';

import { type BillingStore } from './store.js';
import { processStripeWebhook, type SubscriptionRetriever } from './stripe-webhook.js';

/**
 * A Node request handler for the Stripe webhook. It reads the raw body, which the signature check
 * needs, and answers with the status that Stripe uses to decide on a retry. Any failure while
 * applying an event answers 500, so Stripe delivers the event again. A host mounts it on the path it
 * registers with Stripe, and it must not be behind a body parser that rewrites the body.
 */
export const createStripeWebhookHandler =
  (options: {
    secret: string;
    store: BillingStore;
    retrieveSubscription: SubscriptionRetriever;
    now?: () => number;
  }) =>
  async (request: IncomingMessage, response: ServerResponse) => {
    const header = request.headers['stripe-signature'];
    const signature = Array.isArray(header) ? header[0] : header;
    const nowMs = options.now ? options.now() : Date.now();

    try {
      const payload = await text(request);
      const result = await processStripeWebhook({
        payload,
        signature,
        secret: options.secret,
        store: options.store,
        retrieveSubscription: options.retrieveSubscription,
        nowSeconds: Math.floor(nowMs / 1000),
      });

      response.writeHead(result.status, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ message: result.message }));
    } catch {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ message: 'Failed to apply the event.' }));
    }
  };

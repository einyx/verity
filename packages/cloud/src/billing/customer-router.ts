import { RequestError, Router } from '@withtyped/server';
import { z } from 'zod';

import { authorizeTenantAdmin, type OperatorAuthConfig, verifyCaller } from './auth.js';
import { type CheckoutConfig, createPortalSession } from './checkout.js';
import { type BillingStore } from './store.js';

/** Stripe customer routes: the tenant's card portal, its recorded customer, and the user's list. */
export const createCustomerRouter = (
  store: BillingStore,
  auth: OperatorAuthConfig,
  checkout?: CheckoutConfig
) =>
  new Router()
    // A tenant admin may only clear the tenant's customer, or re-select the one already recorded for
    // it. Any other customer ID is refused, so a tenant cannot be pointed at someone else's customer.
    .put(
      '/api/tenants/:tenantId/stripe-customer',
      {
        body: z.object({ customerId: z.string().nullable() }),
        response: z.object({
          tenantId: z.string(),
          createdAt: z.date(),
          updatedAt: z.date(),
          stripeCustomerId: z.string().nullable(),
        }),
      },
      async (context, next) => {
        const { tenantId } = context.guarded.params;
        const requested = context.guarded.body.customerId;

        await authorizeTenantAdmin(context.request.headers.authorization, tenantId, auth, store);

        const current = await store.findStripeCustomerId(tenantId);

        if (requested !== null && requested !== current) {
          throw new RequestError('Customer is not linked to this tenant.', 404);
        }

        await store.setStripeCustomerId(tenantId, requested);

        const subscription = await store.findSubscription(tenantId);
        const since = subscription ? new Date(subscription.currentPeriodStart) : new Date(0);

        return next({
          ...context,
          json: { tenantId, createdAt: since, updatedAt: since, stripeCustomerId: requested },
        });
      }
    )
    // A tenant admin reads the Stripe customer recorded for the tenant.
    .get(
      '/api/tenants/:tenantId/stripe-customer',
      {
        response: z.object({
          tenantId: z.string(),
          createdAt: z.date(),
          updatedAt: z.date(),
          stripeCustomerId: z.string().nullable(),
        }),
      },
      async (context, next) => {
        const { tenantId } = context.guarded.params;

        await authorizeTenantAdmin(context.request.headers.authorization, tenantId, auth, store);

        const subscription = await store.findSubscription(tenantId);
        const stripeCustomerId = await store.findStripeCustomerId(tenantId);
        const since = subscription ? new Date(subscription.currentPeriodStart) : new Date(0);

        return next({
          ...context,
          json: { tenantId, createdAt: since, updatedAt: since, stripeCustomerId },
        });
      }
    )
    // The console sends the page to Stripe's billing portal, where the customer manages their card.
    .post(
      '/api/tenants/:tenantId/stripe-customer-portal',
      {
        body: z.object({ callbackUrl: z.string() }),
        response: z.object({ redirectUri: z.string() }),
      },
      async (context, next) => {
        const { tenantId } = context.guarded.params;

        await authorizeTenantAdmin(context.request.headers.authorization, tenantId, auth, store);

        if (!checkout) {
          throw new RequestError('Checkout is not configured.', 503);
        }

        const customerId = await store.findStripeCustomerId(tenantId);

        if (!customerId) {
          throw new RequestError('No billing account for this tenant.', 404);
        }

        const outcome = await createPortalSession(checkout, {
          customerId,
          returnUrl: context.guarded.body.callbackUrl,
        });

        if (!outcome.ok) {
          throw new RequestError(outcome.message, outcome.status);
        }

        return next({ ...context, json: { redirectUri: outcome.redirectUri } });
      }
    )
    // The account picker lists the Stripe customers of the tenants this user administers.
    .get(
      '/api/me/stripe-customers',
      {
        response: z.array(
          z.object({
            customerId: z.string(),
            createdAt: z.date(),
            isDefault: z.boolean(),
          })
        ),
      },
      async (context, next) => {
        const caller = await verifyCaller(context.request.headers.authorization, auth);
        const customers = await store.listAdminCustomers(caller);
        const defaultCustomerId = await store.findDefaultCustomerId(caller);

        return next({
          ...context,
          json: customers.map(({ customerId, periodStart }) => ({
            customerId,
            createdAt: periodStart,
            isDefault: customerId === defaultCustomerId,
          })),
        });
      }
    )
    // The picker's default is stored per user. Only a customer the user administers can be picked.
    .patch(
      '/api/me/stripe-customers/:customerId',
      {
        body: z.object({ isDefault: z.literal(true) }),
        response: z.object({
          customerId: z.string(),
          createdAt: z.date(),
          isDefault: z.boolean(),
        }),
      },
      async (context, next) => {
        const caller = await verifyCaller(context.request.headers.authorization, auth);
        const { customerId } = context.guarded.params;
        const customers = await store.listAdminCustomers(caller);
        const customer = customers.find((item) => item.customerId === customerId);

        if (!customer) {
          throw new RequestError('Stripe customer not found', 404);
        }

        await store.setDefaultCustomerId(caller, customerId);

        return next({
          ...context,
          json: { customerId, createdAt: customer.periodStart, isDefault: true },
        });
      }
    )
    // An enterprise account is the tenant that holds the shared subscription. Its id is the tenant id.
    // Until the enterprise model is defined, only an admin of that tenant may open its portal.
    .post(
      '/api/me/logto-enterprises/:id/stripe-customer-portal',
      {
        body: z.object({ callbackUrl: z.string().optional() }),
        response: z.object({ redirectUri: z.string() }),
      },
      async (context, next) => {
        const caller = await verifyCaller(context.request.headers.authorization, auth);
        const enterpriseId = context.guarded.params.id;
        const adminCustomers = await store.listAdminCustomers(caller);
        const customer = adminCustomers.find((item) => item.tenantId === enterpriseId);

        if (!customer) {
          throw new RequestError('Enterprise account not found', 404);
        }

        if (!checkout) {
          throw new RequestError('Checkout is not configured.', 503);
        }

        const returnUrl = context.guarded.body.callbackUrl ?? checkout.returnOrigins[0] ?? '';
        const outcome = await createPortalSession(checkout, {
          customerId: customer.customerId,
          returnUrl,
        });

        if (!outcome.ok) {
          throw new RequestError(outcome.message, outcome.status);
        }

        return next({ ...context, json: { redirectUri: outcome.redirectUri } });
      }
    );

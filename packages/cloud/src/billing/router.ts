import { ReservedPlanId } from '@logto/schemas';
import { RequestError, Router } from '@withtyped/server';
import { z } from 'zod';

import {
  authorizeInvitee,
  authorizeCloudTenant,
  authorizeOperator,
  authorizeTenantAdmin,
  authorizeTenantMember,
  type InvitationForAcceptance,
  type OperatorAuthConfig,
} from './auth.js';
import {
  type CheckoutConfig,
  createCheckoutBodyGuard,
  createCheckoutSession,
  readCheckoutStatus,
} from './checkout.js';
import { effectiveSubscription } from './entitlement.js';
import {
  acceptInvitationBodyGuard,
  createInvitationBodyGuard,
  invitationGuard,
  newInvitation,
  toInvitationView,
} from './invitation.js';
import { invoicesResponseGuard } from './invoice.js';
import { type Sku, skuGuard, skuTypeGuard } from './sku.js';
import { type BillingStore } from './store.js';
import { logtoSkuQuotaGuard, type Subscription, subscriptionGuard } from './subscription.js';

/** Stands in for an invitation that does not exist, so the caller gets the same 403 either way. */
const UNUSABLE_INVITATION: InvitationForAcceptance = {
  invitee: '',
  tokenHash: '',
  expiresAt: new Date(0),
  status: 'revoked',
};

/**
 * The subscription read for a tenant with no billing subscription, such as a development tenant. It
 * carries the development plan's quota, or nothing when that plan is missing, so the caller refuses it.
 */
const developmentSubscription = (
  tenantId: string,
  developmentSku?: Sku
): Subscription | undefined => {
  const quota = logtoSkuQuotaGuard.safeParse(developmentSku?.quota);

  if (!quota.success) {
    return undefined;
  }

  const epoch = new Date(0).toISOString();

  return {
    id: tenantId,
    planId: ReservedPlanId.Development,
    currentPeriodStart: epoch,
    currentPeriodEnd: epoch,
    isEnterprisePlan: false,
    isDevPlan: true,
    hasBillingCustomer: false,
    status: 'active',
    quota: quota.data,
    systemLimit: {},
  };
};

/**
 * Billing routes served under `@meshx/cloud/routes`. Paths and response shapes match what the
 * console and core already call on the Cloud API, so they can switch imports without changes.
 */
export const createBillingRouter = (
  store: BillingStore,
  auth: OperatorAuthConfig,
  checkout?: CheckoutConfig
) =>
  new Router()
    .get(
      '/api/tenants/:tenantId/subscription',
      {
        response: subscriptionGuard,
      },
      async (context, next) => {
        const requestedTenantId = context.guarded.params.tenantId;
        // Core's tenant cloud-connection M2M client reads its own subscription via `/my`.
        const tenantId = await (async () => {
          if (requestedTenantId === 'my') {
            const caller = await authorizeCloudTenant(
              context.request.headers.authorization,
              auth,
              store
            );
            return caller.tenantId;
          }

          await authorizeTenantMember(
            context.request.headers.authorization,
            requestedTenantId,
            auth,
            store
          );
          return requestedTenantId;
        })();
        const skus = await store.listSkus({});
        const developmentSku = skus.find((sku) => sku.id === ReservedPlanId.Development);

        // A tenant with no billing subscription, such as a development tenant, reads as the development
        // plan. The development plan must exist to be granted, so a missing one refuses the read.
        const subscription =
          (await store.findSubscription(tenantId)) ??
          developmentSubscription(tenantId, developmentSku);

        // Core reads this to decide the tenant's quota. An ended subscription reads as the development
        // plan, and a missing development plan refuses the read instead of granting paid quota.
        const entitled =
          subscription && effectiveSubscription(subscription, new Date(), developmentSku);

        if (!entitled) {
          throw new RequestError('Subscription plan is unavailable', 503);
        }

        return next({ ...context, json: entitled });
      }
    )
    .get(
      '/api/tenants/:tenantId/invoices',
      {
        response: invoicesResponseGuard,
      },
      async (context, next) => {
        // The console reads this as a tenant admin for their own tenant. Operators may read any tenant.
        try {
          await authorizeOperator(context.request.headers.authorization, auth);
        } catch {
          await authorizeTenantAdmin(
            context.request.headers.authorization,
            context.guarded.params.tenantId,
            auth,
            store
          );
        }

        const invoices = await store.listInvoices(context.guarded.params.tenantId);

        return next({ ...context, json: { invoices } });
      }
    )
    // The public SKU catalogue: the console lists it for every signed-in user, so it has no
    // operator check. Nothing in it is tenant-specific.
    .get(
      '/api/skus',
      {
        search: z.object({ type: skuTypeGuard.optional() }),
        response: z.array(skuGuard),
      },
      async (context, next) => {
        const skus = await store.listSkus({ type: context.guarded.search.type });

        return next({ ...context, json: skus });
      }
    )
    // Tenant admins create and list invitations for their own tenant. The one-time token is returned
    // here, once, so the admin can deliver it to the invitee. Only its hash is stored.
    .post(
      '/api/tenants/:tenantId/invitations',
      {
        body: createInvitationBodyGuard,
        response: z.object({ invitation: invitationGuard, token: z.string() }),
      },
      async (context, next) => {
        const { tenantId } = context.guarded.params;
        const caller = await authorizeTenantAdmin(
          context.request.headers.authorization,
          tenantId,
          auth,
          store
        );
        const { token, record } = newInvitation({
          tenantId,
          invitee: context.guarded.body.invitee,
          inviterSub: caller.sub,
        });

        await store.createInvitation(record);

        return next({ ...context, json: { invitation: toInvitationView(record), token } });
      }
    )
    .get(
      '/api/tenants/:tenantId/invitations',
      {
        response: z.object({ invitations: z.array(invitationGuard) }),
      },
      async (context, next) => {
        const { tenantId } = context.guarded.params;

        await authorizeTenantAdmin(context.request.headers.authorization, tenantId, auth, store);

        const invitations = await store.listInvitations(tenantId);

        return next({
          ...context,
          json: { invitations: invitations.map((invitation) => toInvitationView(invitation)) },
        });
      }
    )
    // The invitee accepts with the one-time token. Authentication runs first, so an unauthenticated
    // caller gets 401 whatever the invitation id. A missing or unusable invitation gets the same 403
    // as a wrong token, so the route does not reveal which invitations exist.
    .post(
      '/api/invitations/:invitationId/accept',
      {
        body: acceptInvitationBodyGuard,
        response: z.object({ invitation: invitationGuard }),
      },
      async (context, next) => {
        const invitation = await store.findInvitation(context.guarded.params.invitationId);

        await authorizeInvitee(
          context.request.headers.authorization,
          invitation ?? UNUSABLE_INVITATION,
          context.guarded.body.token,
          auth
        );

        // AuthorizeInvitee has already rejected a missing invitation, so this only narrows the type.
        if (!invitation) {
          throw new RequestError('Forbidden', 403);
        }

        const accepted = { ...invitation, status: 'accepted' as const };

        await store.setInvitationStatus(accepted.id, 'accepted');

        return next({ ...context, json: { invitation: toInvitationView(accepted) } });
      }
    )
    // Tenant admins start a subscription checkout for their own tenant. The route refuses when no
    // checkout is configured, so a deployment cannot sell plans it has not set up.
    .post(
      '/api/checkout-session',
      {
        body: createCheckoutBodyGuard,
        response: z.object({ redirectUri: z.string(), sessionId: z.string() }),
      },
      async (context, next) => {
        const { body } = context.guarded;

        await authorizeTenantAdmin(
          context.request.headers.authorization,
          body.tenantId,
          auth,
          store
        );

        if (!checkout) {
          throw new RequestError('Checkout is not configured.', 503);
        }

        const outcome = await createCheckoutSession(checkout, body);

        if (!outcome.ok) {
          throw new RequestError(outcome.message, outcome.status);
        }

        return next({
          ...context,
          json: { redirectUri: outcome.redirectUri, sessionId: outcome.sessionId },
        });
      }
    )
    // The console polls this after Stripe returns the tenant. The session's own tenant decides who
    // may read it, so a tenant admin of another tenant gets 403.
    .get(
      '/api/checkout-session/:sessionId',
      {
        response: z.object({
          tenantId: z.string(),
          skuId: z.string(),
          status: z.enum(['complete', 'open']),
        }),
      },
      async (context, next) => {
        if (!checkout) {
          throw new RequestError('Checkout is not configured.', 503);
        }

        const status = await readCheckoutStatus(checkout, context.guarded.params.sessionId);

        if (!status) {
          throw new RequestError('Checkout session not found', 404);
        }

        await authorizeTenantAdmin(
          context.request.headers.authorization,
          status.tenantId,
          auth,
          store
        );

        return next({ ...context, json: status });
      }
    );

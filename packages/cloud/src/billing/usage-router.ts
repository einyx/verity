import { RequestError, Router } from '@withtyped/server';
import { z } from 'zod';

import { authorizeTenantAdmin, type OperatorAuthConfig } from './auth.js';
import { skuGuard } from './sku.js';
import { type BillingStore } from './store.js';

/**
 * Subscription routes the console reads on the subscription page: the add-on SKUs a tenant can buy,
 * and the periodic usage against the plan's limits. No add-ons are sold yet, so the list is empty.
 */
export const createUsageRouter = (store: BillingStore, auth: OperatorAuthConfig) =>
  new Router()
    .get(
      '/api/tenants/:tenantId/subscription/add-on-skus',
      { response: z.array(skuGuard) },
      async (context, next) => {
        await authorizeTenantAdmin(
          context.request.headers.authorization,
          context.guarded.params.tenantId,
          auth,
          store
        );

        return next({ ...context, json: [] });
      }
    )
    .get(
      '/api/tenants/:tenantId/subscription/periodic-usage',
      {
        response: z.object({
          mauLimit: z.number(),
          tokenLimit: z.number(),
          userTokenLimit: z.number(),
          m2mTokenLimit: z.number(),
        }),
      },
      async (context, next) => {
        const { tenantId } = context.guarded.params;

        await authorizeTenantAdmin(context.request.headers.authorization, tenantId, auth, store);

        const subscription = await store.findSubscription(tenantId);

        if (!subscription) {
          throw new RequestError('Subscription not found', 404);
        }

        const tokenLimit = subscription.quota.tokenLimit ?? 0;

        return next({
          ...context,
          json: {
            mauLimit: subscription.quota.mauLimit ?? 0,
            tokenLimit,
            // The plan has one token limit, so the user and machine-to-machine limits are reported as the same.
            userTokenLimit: tokenLimit,
            m2mTokenLimit: tokenLimit,
          },
        });
      }
    );

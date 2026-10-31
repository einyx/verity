import { getCloudApiIndicator } from '@logto/schemas';
import { createPool } from '@silverhand/slonik';
import { endOfDay, startOfMonth, subDays } from 'date-fns';
import type { Context, Next } from 'koa';

import { type CloudBillingStore, loadCloudPlugin } from '#src/cloud-plugin/index.js';
import { EnvSet } from '#src/env-set/index.js';
import { verifyBearerTokenFromRequest } from '#src/middleware/koa-auth/index.js';
import { getTenantForUsage } from '#src/tenants/tenant-lookup.js';

const periodicUsagePath = /^\/api\/tenants\/([^/]+)\/subscription\/periodic-usage$/;

/**
 * Serves the tenant's periodic usage for the console's subscription page. A caller must be an admin of
 * the tenant, as recorded in the billing membership table. MAU is the active users over the last 30
 * days; token usage is counted for the current billing period.
 */
export const periodicUsageRoute = (envSet: EnvSet) => {
  // Created on first use, so the billing database is only needed when this route is called.
  // eslint-disable-next-line @silverhand/fp/no-let -- Retain one lazily initialized promise per middleware instance.
  let billingStore: Promise<CloudBillingStore> | undefined;

  return async (ctx: Context, next: Next) => {
    const match = periodicUsagePath.exec(ctx.path);

    if (ctx.method !== 'GET' || !match?.[1]) {
      return next();
    }

    const tenantId = decodeURIComponent(match[1]);
    const adminOrigin = EnvSet.values.adminUrlSet.endpoint.origin;
    const { sub } = await verifyBearerTokenFromRequest(
      envSet,
      ctx.request,
      getCloudApiIndicator(EnvSet.values.cloudUrlSet.endpoint.origin)
    );
    // eslint-disable-next-line @silverhand/fp/no-mutation -- Cache the first authenticated request's initialization, including concurrent callers.
    billingStore ??= (async () => {
      const { createPgBillingStore } = await loadCloudPlugin();
      return createPgBillingStore(await createPool(process.env.BILLING_DATABASE_URL ?? ''));
    })();
    const store = await billingStore;
    const role = await store.findMembership(tenantId, { issuer: `${adminOrigin}/oidc`, sub });

    if (role !== 'admin') {
      ctx.status = 404;
      ctx.body = { code: 'tenant.not_found', message: 'Tenant not found.' };

      return;
    }

    const subscription = await store.findSubscription(tenantId);
    const now = new Date();
    // A tenant without a billing subscription (a development tenant, or one not yet synced) still has
    // usage. It is measured over the current calendar month rather than refused.
    const periodStart = subscription?.currentPeriodStart ?? startOfMonth(now);

    const tenant = await getTenantForUsage(tenantId);
    const [usage, mau] = await Promise.all([
      tenant.subscription.getTenantTokenUsage({
        from: new Date(periodStart),
        to: now,
      }),
      tenant.queries.dailyActiveUsers.countActiveUsersByTimeInterval(
        endOfDay(subDays(now, 30)).valueOf(),
        endOfDay(now).valueOf()
      ),
    ]);

    ctx.body = {
      mauLimit: mau.count,
      tokenLimit: usage.totalUsage,
      userTokenLimit: usage.userTokenUsage,
      m2mTokenLimit: usage.m2mTokenUsage,
    };
  };
};

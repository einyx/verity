import { adminTenantId } from '@logto/schemas';
import type Koa from 'koa';

import { EnvSet } from '#src/env-set/index.js';
import { billingRoutes, isBillingConfigured } from '#src/routes/billing.js';
import { localCloudRoutes } from '#src/routes/cloud-dev.js';
import { cloudTenantRoutes } from '#src/routes/cloud-tenants.js';
import { createSharedHitStore } from '#src/routes/landing-page-chat-counters.js';
import {
  createChatState,
  createProductionChatDeps,
  landingPageChatRoutes,
} from '#src/routes/landing-page-chat.js';
import { landingPageLeadRoutes } from '#src/routes/landing-page-leads.js';
import { landingPageRoutes } from '#src/routes/landing-page.js';
import { periodicUsageRoute } from '#src/routes/periodic-usage.js';

/**
 * Mounts the admin tenant's cloud routes. The dev stand-ins serve only when the instance is cloud.
 * The billing API serves in production, after the stand-ins, and never reaches them there.
 */
export const mountAdminRoutes = (app: Koa, id: string, envSet: EnvSet) => {
  if (id !== adminTenantId) {
    return;
  }

  if (EnvSet.values.isCloud) {
    app.use(cloudTenantRoutes(envSet).routes());

    app.use(landingPageRoutes(envSet).routes());

    app.use(landingPageLeadRoutes(envSet).routes());

    // Public demo chat. It stays off unless the published landing document switches it on.
    // Limits are counted in the database, so they hold across every instance.
    const chatState = createChatState(createSharedHitStore(async () => EnvSet.sharedPool));
    app.use(landingPageChatRoutes(createProductionChatDeps(), chatState).routes());
  }

  app.use(localCloudRoutes());
  // Real usage is served before the billing API, which does not meter usage.
  app.use(periodicUsageRoute(envSet));

  // Local development serves billing only once its settings are present, so the stand-ins keep working without them.
  if (EnvSet.values.isProduction || isBillingConfigured()) {
    app.use(billingRoutes());
  }
};

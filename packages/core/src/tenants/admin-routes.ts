import { adminTenantId } from '@logto/schemas';
import type Koa from 'koa';

import { EnvSet } from '#src/env-set/index.js';
import { billingRoutes } from '#src/routes/billing.js';
import { localCloudRoutes } from '#src/routes/cloud-dev.js';
import { cloudTenantRoutes } from '#src/routes/cloud-tenants.js';

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
  }

  app.use(localCloudRoutes());

  if (EnvSet.values.isProduction) {
    app.use(billingRoutes());
  }
};

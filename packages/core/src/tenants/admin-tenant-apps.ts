import type Koa from 'koa';
import mount from 'koa-mount';

import { AdminApps, EnvSet } from '#src/env-set/index.js';
import koaConsoleRedirectProxy from '#src/middleware/koa-console-redirect-proxy.js';
import koaLandingProxy from '#src/middleware/koa-landing-proxy.js';
import koaSpaProxy from '#src/middleware/koa-spa-proxy.js';
import { isLocalCloud } from '#src/routes/cloud-dev.js';
import initMeApis from '#src/routes-me/init.js';

import type Queries from './Queries.js';
import type TenantContext from './TenantContext.js';

/**
 * Mounts the marketing site proxy at the root when `LANDING_UPSTREAM` names the site's server.
 * Part of the landing page CMS feature.
 */
const mountLandingSite = (app: Koa) => {
  const upstream = process.env.LANDING_UPSTREAM?.trim();
  if (EnvSet.values.isDevFeaturesEnabled && upstream) {
    app.use(koaLandingProxy(upstream));
  }
};

type AdminTenantAppsOptions = {
  tenantContext: TenantContext;
  mountedApps: Parameters<typeof koaSpaProxy>[0]['mountedApps'];
  queries: Queries;
};

/** Mounts the admin tenant's `/me` APIs, the marketing site and the admin console. */
export const mountAdminTenantApps = (
  app: Koa,
  { tenantContext, mountedApps, queries }: AdminTenantAppsOptions
) => {
  const { isMultiTenancy } = EnvSet.values;

  // Mount `/me` APIs for admin tenant
  app.use(mount('/me', initMeApis(tenantContext)));

  // Serve the marketing site at the root when a site is configured. Its paths are forwarded before
  // the console redirect below, so `/` shows the site and `/console` stays with the console.
  mountLandingSite(app);

  // Mount Admin Console when needed
  // Skip in multi-tenancy mode since Logto Cloud serves Admin Console in this case; local cloud
  // runs as a single instance, so it serves the console itself.
  if (!isMultiTenancy || isLocalCloud()) {
    app.use(koaConsoleRedirectProxy(queries));
    app.use(
      mount(
        '/' + AdminApps.Console,
        koaSpaProxy({
          mountedApps,
          queries,
          packagePath: AdminApps.Console,
          port: 5002,
          prefix: AdminApps.Console,
        })
      )
    );
  }
};

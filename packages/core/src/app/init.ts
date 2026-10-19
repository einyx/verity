import fs from 'node:fs/promises';
import http2 from 'node:http2';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { appInsights } from '@logto/app-insights/node';
import { ConsoleLog } from '@logto/shared';
import { toTitle, trySafe } from '@silverhand/essentials';
import chalk from 'chalk';
import type Koa from 'koa';
import koaLogger from 'koa-logger';
import send from 'koa-send';
import { nanoid } from 'nanoid';

import { EnvSet } from '#src/env-set/index.js';
import { TenantNotFoundError, tenantPool } from '#src/tenants/index.js';
import { getConsoleLogFromContext } from '#src/utils/console.js';
import { buildAppInsightsTelemetry } from '#src/utils/request.js';
import { getTenantId } from '#src/utils/tenant.js';

const logListening = (type: 'core' | 'admin' = 'core') => {
  const urlSet = type === 'core' ? EnvSet.values.urlSet : EnvSet.values.adminUrlSet;
  const consoleLog = new ConsoleLog(chalk.magenta(type));

  for (const url of urlSet.deduplicated()) {
    consoleLog.info(chalk.bold(`${toTitle(type)} app is running at ${url.toString()}`));
  }
};

const serverTimeout = 120_000;

const consoleDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../console'
);

// The landing page ships with the console: `dist/landing` in the image, `public/landing` in the source tree.
const readLandingPage = async (): Promise<string | undefined> => {
  const candidates = [
    path.join(consoleDirectory, 'dist/landing/index.html'),
    path.join(consoleDirectory, 'public/landing/index.html'),
  ];

  for (const file of candidates) {
    // Candidates are tried in order and the first readable file wins, so each read must finish before the next.
    // eslint-disable-next-line no-await-in-loop
    const content = await trySafe(fs.readFile(file, 'utf8'));

    if (content) {
      return content;
    }
  }

  return undefined;
};

// The landing page HTML loads its assets from `/console/landing/...` and its favicons from `/favicon...`
// on the root of every domain. Serve those files from the landing build on domain-based cloud hosts;
// anything that is not an existing file falls through to normal routing.
const landingAssetPrefix = '/console/landing/';
const landingRootAssetPrefix = '/favicon';

const serveLandingAsset = async (ctx: Koa.Context, next: Koa.Next) => {
  const { pathname } = ctx.URL;
  const isLandingAsset =
    pathname.startsWith(landingAssetPrefix) || pathname.startsWith(landingRootAssetPrefix);

  if (
    ctx.method !== 'GET' ||
    !EnvSet.values.isDomainBasedMultiTenancy ||
    !EnvSet.values.isCloud ||
    !isLandingAsset
  ) {
    return next();
  }

  const relativePath = pathname.startsWith(landingAssetPrefix)
    ? pathname.slice(landingAssetPrefix.length)
    : pathname.slice(1);

  const served = await send(ctx, relativePath, {
    root: path.join(consoleDirectory, 'dist/landing'),
    maxage: 604_800_000 /* 7 days */,
  }).then(
    () => true,
    () => false
  );

  return served ? undefined : next();
};

export default async function initApp(app: Koa): Promise<void> {
  app.use(async (ctx, next) => {
    const requestId = nanoid(16);
    const consoleLog = new ConsoleLog(chalk.blue(requestId));
    ctx.requestId = requestId;
    ctx.console = consoleLog;

    await koaLogger({
      transporter: (string, [, _, requestPath]) => {
        // Ignoring static file requests in development since vite will load a crazy amount of files
        if (!EnvSet.values.isProduction && path.basename(requestPath).includes('.')) {
          return;
        }
        consoleLog.plain(string);
      },
    })(ctx, next);

    // Set the header in the end to avoid other middleware from overwriting it
    ctx.set('Logto-Core-Request-Id', requestId);
  });

  app.use(serveLandingAsset);

  app.use(async (ctx, next) => {
    // The root answers 204 for health probes. A browser asking for the root gets the landing page instead.
    const isProbe = ['/status', '/'].includes(ctx.URL.pathname);

    if (EnvSet.values.isDomainBasedMultiTenancy && isProbe) {
      // Only a browser asks for HTML; probes send no Accept header or a non-HTML one.
      if (
        ctx.URL.pathname === '/' &&
        EnvSet.values.isCloud &&
        ctx.get('accept').includes('text/html')
      ) {
        const landing = await readLandingPage();

        if (landing) {
          ctx.type = 'html';
          ctx.body = landing;

          return;
        }
      }

      ctx.status = 204;

      return next();
    }

    const [tenantId, isCustomDomain] = await getTenantId(ctx.URL);

    if (!tenantId) {
      ctx.status = 404;

      return next();
    }

    // If the request is a custom domain of the tenant, use the custom endpoint to build "OIDC issuer"
    // otherwise, build from the default endpoint (subdomain).
    const customEndpoint = isCustomDomain ? ctx.URL.origin : undefined;

    const tenant = await trySafe(tenantPool.get(tenantId, customEndpoint), (error) => {
      ctx.status = error instanceof TenantNotFoundError ? 404 : 500;
      getConsoleLogFromContext(ctx).error(error);
      void appInsights.trackException(error, buildAppInsightsTelemetry(ctx));
    });

    if (!tenant) {
      return next();
    }

    // The request slot is reserved by `tenantPool.get()` so the database pool stays alive until
    // this request finishes; release it exactly once here.
    try {
      await tenant.run(ctx, next);
    } catch (error: unknown) {
      void appInsights.trackException(error, buildAppInsightsTelemetry(ctx));

      throw error;
    } finally {
      tenant.requestEnd();
    }
  });

  const { isHttpsEnabled, httpsCert, httpsKey, urlSet, adminUrlSet } = EnvSet.values;

  if (isHttpsEnabled && httpsCert && httpsKey) {
    const createHttp2Server = async () =>
      http2.createSecureServer(
        { cert: await fs.readFile(httpsCert), key: await fs.readFile(httpsKey), allowHTTP1: true },
        app.callback()
      );

    const coreServer = await createHttp2Server();
    coreServer.listen(urlSet.port, () => {
      logListening();
    });
    coreServer.setTimeout(serverTimeout);

    // Create another server if admin localhost enabled
    if (!adminUrlSet.isLocalhostDisabled) {
      const adminServer = await createHttp2Server();
      adminServer.listen(adminUrlSet.port, () => {
        logListening('admin');
      });
      adminServer.setTimeout(serverTimeout);
    }

    return;
  }

  // Chrome doesn't allow insecure HTTP/2 servers, stick with HTTP for localhost.
  const coreServer = app.listen(urlSet.port, () => {
    logListening();
  });
  coreServer.setTimeout(serverTimeout);

  // Create another server if admin localhost enabled
  if (!adminUrlSet.isLocalhostDisabled) {
    const adminServer = app.listen(adminUrlSet.port, () => {
      logListening('admin');
    });
    adminServer.setTimeout(serverTimeout);
  }
}

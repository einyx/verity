import type Koa from 'koa';
import koaCompress from 'koa-compress';

import koaConnectorErrorHandler from '#src/middleware/koa-connector-error-handler.js';
import koaErrorHandler from '#src/middleware/koa-error-handler.js';
import koaI18next from '#src/middleware/koa-i18next.js';
import koaOidcErrorHandler from '#src/middleware/koa-oidc-error-handler.js';
import koaSecurityHeaders from '#src/middleware/koa-security-headers.js';
import koaSlonikErrorHandler from '#src/middleware/koa-slonik-error-handler.js';

/** Middleware every tenant app runs first: i18n, error handling, compression, and security headers. */
export const mountBaseMiddleware = (
  app: Koa,
  mountedApps: Parameters<typeof koaSecurityHeaders>[0],
  id: string
) => {
  app.use(koaI18next());
  app.use(koaErrorHandler());
  app.use(koaOidcErrorHandler());
  app.use(koaSlonikErrorHandler());
  app.use(koaConnectorErrorHandler());
  app.use(koaCompress());
  app.use(koaSecurityHeaders(mountedApps, id));
};

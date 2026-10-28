import type { MiddlewareType } from 'koa';

// Serves the marketing site at the root. Its public paths (the one-pager, the other site pages and
// their static files) are fetched from the site's server and returned as they are; everything else,
// including `/console`, the APIs and the sign-in endpoints, continues to Logto. Only GET and HEAD are
// forwarded, so the site never sees a form post or any other write.

const landingPaths = [
  '/',
  '/about',
  '/contact',
  '/demo',
  '/legal',
  '/_astro',
  '/favicon',
  '/favicon.ico',
  '/robots.txt',
  '/sitemap-index.xml',
  '/share_image',
];

// Headers that describe one connection, or that fetch has already applied to the body.
const skippedHeaders = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-encoding',
  'content-length',
]);

export const isLandingPath = (path: string) =>
  landingPaths.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

export default function koaLandingProxy(upstream: string): MiddlewareType {
  const origin = new URL(upstream);

  return async (ctx, next) => {
    if (!['GET', 'HEAD'].includes(ctx.method) || !isLandingPath(ctx.path)) {
      return next();
    }

    const resolved = new URL(ctx.originalUrl, origin);

    // A user-controlled original URL can be absolute (`https://…`, `//host/…`); never fetch
    // anything outside the configured upstream origin.
    if (resolved.origin !== origin.origin) {
      return next();
    }

    const response = await fetch(resolved, {
      method: ctx.method,
      redirect: 'manual',
    });

    ctx.status = response.status;
    for (const [name, value] of response.headers) {
      if (!skippedHeaders.has(name)) {
        ctx.set(name, value);
      }
    }
    ctx.body = ctx.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer());
  };
}

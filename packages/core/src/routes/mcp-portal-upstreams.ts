import {
  assertPublicHttpsUrl,
  checkReachable,
  CredentialKeyError,
  DuplicateUpstreamError,
  encryptCredential,
  UpstreamUrlError,
  upstreamNamePattern,
} from '@logto/mcp-portal';
import { array, boolean, object, string } from 'zod';

import koaGuard from '#src/middleware/koa-guard.js';

import { credentialKey, ReauthRequiredError, unlockFor } from './mcp-portal-credentials.js';
import {
  audit,
  invalidName,
  invalidPortal,
  notFound,
  portalIdPattern,
  upstreamPool,
  upstreamView,
  type McpPortalStores,
} from './mcp-portal-shared.js';
import type { ManagementApiRouter } from './types.js';

const createUpstreamBody = object({
  name: string().regex(upstreamNamePattern),
  url: string().url(),
});

// Per-server and per-tool switches, and the organizations that can see a server.
const updateUpstreamBody = object({
  enabled: boolean().optional(),
  disabledTools: array(string().min(1).max(200)).max(500).optional(),
  organizationIds: array(string().min(1).max(64)).max(100).optional(),
}).strict();

// The bearer token an admin stores for one server. It is accepted here and never returned.
const credentialBody = object({
  token: string().min(1).max(4096),
}).strict();

/** The servers of a portal: their list, switches, tools, and tokens. */
export const registerUpstreamRoutes = <T extends ManagementApiRouter>(
  router: T,
  load: () => Promise<McpPortalStores>
) => {
  router.get('/mcp-portal/portals/:portalId/upstreams', async (ctx, next) => {
    const { portalId } = ctx.params;

    if (!portalId || !portalIdPattern.test(portalId)) {
      invalidPortal(ctx);
      return next();
    }

    const { upstreams } = await load();
    const listed = await upstreams.listForPortal(portalId);
    ctx.body = {
      upstreams: listed.map(
        ({ name, url, createdAt, enabled, disabledTools, organizationIds }) => ({
          name,
          url,
          createdAt,
          enabled,
          disabledTools,
          organizationIds,
        })
      ),
    };
    return next();
  });

  router.post(
    '/mcp-portal/portals/:portalId/upstreams',
    koaGuard({ body: createUpstreamBody, status: [201, 400, 404, 409] }),
    async (ctx, next) => {
      const { portalId } = ctx.params;
      const { name, url } = ctx.guard.body;

      if (!portalId || !portalIdPattern.test(portalId)) {
        invalidPortal(ctx);
        return next();
      }

      const { portals, upstreams } = await load();

      if (!(await portals.findById(portalId))) {
        notFound(ctx, 'Portal not found');
        return next();
      }

      try {
        await assertPublicHttpsUrl(url);
      } catch (error: unknown) {
        if (!(error instanceof UpstreamUrlError)) {
          throw error;
        }

        ctx.status = 400;
        ctx.body = { code: 'mcp_portal.invalid_url', message: error.message };
        return next();
      }

      try {
        const upstream = await upstreams.add({ name, url, portalId });
        audit({ action: 'upstream.add', sub: ctx.auth.id, upstream: name, outcome: 'ok' });
        // The server is kept either way, so a server that is down right now can be fixed later.
        const reachable = await checkReachable(upstreamPool, upstream);
        ctx.status = 201;
        ctx.body = {
          name: upstream.name,
          url: upstream.url,
          createdAt: upstream.createdAt,
          reachable,
        };
      } catch (error: unknown) {
        if (!(error instanceof DuplicateUpstreamError)) {
          throw error;
        }

        ctx.status = 409;
        ctx.body = { code: 'mcp_portal.duplicate', message: error.message };
      }

      return next();
    }
  );

  router.get('/mcp-portal/portals/:portalId/upstreams/:name/tools', async (ctx, next) => {
    const { portalId, name } = ctx.params;

    if (!portalId || !portalIdPattern.test(portalId) || !name || !upstreamNamePattern.test(name)) {
      invalidName(ctx);
      return next();
    }

    const { upstreams } = await load();
    const upstream = await upstreams.findForPortal(portalId, name);

    if (!upstream) {
      notFound(ctx, `Upstream "${name}" not found`);
      return next();
    }

    try {
      // Send the stored credential, as the MCP endpoint does; without it the upstream answers 401.
      const client = await upstreamPool.get(upstream, await unlockFor(upstreams)(upstream));
      const { tools } = await client.listTools();
      ctx.body = {
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description ?? '',
          enabled: !upstream.disabledTools.includes(tool.name),
        })),
      };
    } catch (error: unknown) {
      await upstreamPool.invalidate(upstream);

      if (error instanceof ReauthRequiredError) {
        // The stored sign-in is dead; retrying the upstream will not help until the admin signs in again.
        ctx.status = 409;
        ctx.body = {
          code: 'mcp_portal.upstream_reauth_required',
          message: `Sign in to "${name}" again.`,
        };

        return next();
      }

      ctx.status = 503;
      ctx.body = {
        code: 'mcp_portal.upstream_unavailable',
        message: `Upstream "${name}" did not answer`,
      };
    }

    return next();
  });

  router.patch(
    '/mcp-portal/portals/:portalId/upstreams/:name',
    koaGuard({ body: updateUpstreamBody, status: [200, 400, 404] }),
    async (ctx, next) => {
      const { portalId, name } = ctx.params;

      if (
        !portalId ||
        !portalIdPattern.test(portalId) ||
        !name ||
        !upstreamNamePattern.test(name)
      ) {
        invalidName(ctx);
        return next();
      }

      const { upstreams } = await load();
      const upstream = await upstreams.update(portalId, name, ctx.guard.body);

      if (!upstream) {
        notFound(ctx, `Upstream "${name}" not found`);
        return next();
      }

      audit({ action: 'upstream.update', sub: ctx.auth.id, upstream: name, outcome: 'ok' });
      ctx.body = upstreamView(upstream);
      return next();
    }
  );

  router.delete('/mcp-portal/portals/:portalId/upstreams/:name', async (ctx, next) => {
    const { portalId, name } = ctx.params;

    if (!portalId || !portalIdPattern.test(portalId) || !name || !upstreamNamePattern.test(name)) {
      invalidName(ctx);
      return next();
    }

    const { upstreams } = await load();
    const existing = await upstreams.findForPortal(portalId, name);

    if (!existing || !(await upstreams.remove(portalId, name))) {
      notFound(ctx, `Upstream "${name}" not found`);
      return next();
    }

    await upstreamPool.invalidate(existing);
    audit({ action: 'upstream.remove', sub: ctx.auth.id, upstream: name, outcome: 'ok' });
    ctx.status = 204;
    return next();
  });

  // Write-only: the token goes in, and only `hasCredential` comes back. Changing it drops the cached
  // connection so the next call uses the new token.
  router.put(
    '/mcp-portal/portals/:portalId/upstreams/:name/credential',
    koaGuard({ body: credentialBody, status: [200, 400, 404, 503] }),
    async (ctx, next) => {
      const { portalId, name } = ctx.params;

      if (
        !portalId ||
        !portalIdPattern.test(portalId) ||
        !name ||
        !upstreamNamePattern.test(name)
      ) {
        invalidName(ctx);
        return next();
      }

      const { upstreams } = await load();
      const existing = await upstreams.findForPortal(portalId, name);

      if (!existing) {
        notFound(ctx, `Upstream "${name}" not found`);
        return next();
      }

      try {
        const ciphertext = encryptCredential(ctx.guard.body.token, credentialKey());
        await upstreams.setCredential(portalId, name, ciphertext);
      } catch (error: unknown) {
        if (!(error instanceof CredentialKeyError)) {
          throw error;
        }

        ctx.status = 503;
        ctx.body = { code: 'mcp_portal.encryption_key_missing', message: error.message };
        return next();
      }

      await upstreamPool.invalidate(existing);
      audit({ action: 'upstream.update', sub: ctx.auth.id, upstream: name, outcome: 'ok' });
      ctx.body = upstreamView({ ...existing, hasCredential: true });
      return next();
    }
  );

  router.delete('/mcp-portal/portals/:portalId/upstreams/:name/credential', async (ctx, next) => {
    const { portalId, name } = ctx.params;

    if (!portalId || !portalIdPattern.test(portalId) || !name || !upstreamNamePattern.test(name)) {
      invalidName(ctx);
      return next();
    }

    const { upstreams } = await load();
    const existing = await upstreams.findForPortal(portalId, name);

    if (!existing || !(await upstreams.setCredential(portalId, name))) {
      notFound(ctx, `Upstream "${name}" not found`);
      return next();
    }

    await upstreamPool.invalidate(existing);
    audit({ action: 'upstream.update', sub: ctx.auth.id, upstream: name, outcome: 'ok' });
    ctx.body = upstreamView({ ...existing, hasCredential: false });
    return next();
  });
};

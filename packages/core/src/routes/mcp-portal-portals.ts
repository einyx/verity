import { DuplicatePortalError, hostnamePattern } from '@logto/mcp-portal';
import { array, object, string } from 'zod';

import koaGuard from '#src/middleware/koa-guard.js';
import { clearCustomDomainCache } from '#src/utils/tenant.js';

import {
  audit,
  invalidPortal,
  notFound,
  portalIdPattern,
  upstreamPool,
  type McpPortalStores,
} from './mcp-portal-shared.js';
import type { ManagementApiRouter } from './types.js';

// A DNS label: letters, digits and hyphens, no leading or trailing hyphen.
const subdomainPattern = /^[\da-z](?:[\da-z-]{0,61}[\da-z])?$/;

const createPortalBody = object({
  name: string().min(1).max(100),
  subdomain: string().regex(subdomainPattern),
}).strict();

const updateSettingsBody = object({
  baseDomain: string().regex(hostnamePattern),
}).strict();

const updatePortalOrganizationsBody = object({
  organizationIds: array(string().min(1).max(64)).max(100),
}).strict();

/** Portals, their base domain, and which organizations may use each portal. */
export const registerPortalRoutes = <T extends ManagementApiRouter>(
  router: T,
  load: () => Promise<McpPortalStores>
) => {
  router.get('/mcp-portal/portals', async (ctx, next) => {
    const { portals } = await load();
    ctx.body = { portals: await portals.list() };
    return next();
  });

  // The base domain is set from the console. A portal's hostname is <subdomain>.<base domain>.
  router.get('/mcp-portal/settings', async (ctx, next) => {
    const { settings } = await load();
    ctx.body = await settings.get();
    return next();
  });

  router.put(
    '/mcp-portal/settings',
    koaGuard({ body: updateSettingsBody, status: [200, 400] }),
    async (ctx, next) => {
      const { settings } = await load();
      ctx.body = await settings.setBaseDomain(ctx.guard.body.baseDomain);
      audit({ action: 'portal.settings', sub: ctx.auth.id, outcome: 'ok' });
      return next();
    }
  );

  router.post(
    '/mcp-portal/portals',
    koaGuard({ body: createPortalBody, status: [201, 400, 409] }),
    async (ctx, next) => {
      const { portals, settings } = await load();
      const { baseDomain } = await settings.get();

      if (!baseDomain) {
        ctx.status = 400;
        ctx.body = { code: 'mcp_portal.base_domain_not_set', message: 'Set the base domain first' };
        return next();
      }

      const hostname = `${ctx.guard.body.subdomain}.${baseDomain}`;

      if (!hostnamePattern.test(hostname)) {
        ctx.status = 400;
        ctx.body = { code: 'mcp_portal.invalid_hostname', message: 'The hostname is not valid' };
        return next();
      }

      try {
        ctx.status = 201;
        ctx.body = await portals.add({ name: ctx.guard.body.name, hostname });
        await clearCustomDomainCache(hostname);
      } catch (error: unknown) {
        if (!(error instanceof DuplicatePortalError)) {
          throw error;
        }

        ctx.status = 409;
        ctx.body = { code: 'mcp_portal.duplicate', message: error.message };
      }

      return next();
    }
  );

  router.delete('/mcp-portal/portals/:portalId', async (ctx, next) => {
    const { portalId } = ctx.params;

    if (!portalId || !portalIdPattern.test(portalId)) {
      invalidPortal(ctx);
      return next();
    }

    const { portals, upstreams } = await load();
    const portal = await portals.findById(portalId);

    if (!portal) {
      notFound(ctx, 'Portal not found');
      return next();
    }

    // Upstreams belong to the portal, so they go with it.
    const linked = await upstreams.listForPortal(portalId);
    await Promise.all(
      linked.map(async (upstream) => {
        await upstreams.remove(portalId, upstream.name);
        await upstreamPool.invalidate(upstream);
      })
    );

    if (!(await portals.remove(portalId))) {
      notFound(ctx, 'Portal not found');
      return next();
    }

    await clearCustomDomainCache(portal.hostname);

    audit({ action: 'portal.remove', sub: ctx.auth.id, portal: portalId, outcome: 'ok' });
    ctx.status = 204;
    return next();
  });

  router.put(
    '/mcp-portal/portals/:portalId/organizations',
    koaGuard({ body: updatePortalOrganizationsBody, status: [200, 400, 404] }),
    async (ctx, next) => {
      const { portalId } = ctx.params;

      if (!portalId || !portalIdPattern.test(portalId)) {
        invalidPortal(ctx);
        return next();
      }

      const { portals } = await load();
      const portal = await portals.setOrganizations(portalId, [
        ...new Set(ctx.guard.body.organizationIds),
      ]);

      if (!portal) {
        notFound(ctx, 'Portal not found');
        return next();
      }

      audit({ action: 'portal.organizations', sub: ctx.auth.id, portal: portalId, outcome: 'ok' });
      ctx.body = portal;
      return next();
    }
  );
};

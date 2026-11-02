import type { Context } from 'koa';
import type Router from 'koa-router';
import { z } from 'zod/v3';

import { EnvSet } from '#src/env-set/index.js';
import koaGuard from '#src/middleware/koa-guard.js';
import { deleteDevelopmentTenant } from '#src/tenants/delete-development-tenant.js';

/** Own this response before the billing catch-all; never fall through after deletion. */
export const mountCloudTenantDeletionRoute = (
  router: Router,
  authenticate: (ctx: Context) => Promise<string>
) => {
  router.delete(
    '/api/tenants/:tenantId',
    koaGuard({
      params: z.object({ tenantId: z.string().regex(/^[\w-]{1,21}$/i) }),
      status: [204, 400, 401, 403, 404, 409, 503],
    }),
    async (ctx) => {
      // Verifies the signed admin issuer, Cloud audience/scope, user-token
      // identity and global access policy before destructive database work.
      const actorId = await authenticate(ctx);
      await deleteDevelopmentTenant(await EnvSet.sharedPool, {
        tenantId: ctx.guard.params.tenantId,
        actorId,
      });
      ctx.status = 204;
    }
  );
};

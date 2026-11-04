import { array, boolean, object, record, string } from 'zod/v3';

import koaGuard from '#src/middleware/koa-guard.js';
import { safeParseJson } from '#src/utils/json.js';

import { readBoundedResponse } from './bounded-response.js';
import { resolveKuboAccess } from './kubo-access.js';
import { priceKuboCapacity } from './kubo-capacity-prices.js';
import { requestKubo } from './kubo-transport.js';
import type { ManagementApiRouter, ManagementApiRouterContext, RouterInitArgs } from './types.js';

const kubeName = /^[\da-z]([\da-z-]{0,61}[\da-z])?$/;
const readinessBody = object({ tenantMutationsEnabled: boolean() }).strict();
const createStackBody = object({
  template: string(),
  tenant: string().regex(kubeName),
  mode: string().optional(),
  authProvider: string().optional(),
  exclude: array(string()).optional(),
  operators: record(boolean()).optional(),
  bootstrapM2M: boolean().optional(),
}).strict();
const patchFields = new Set([
  'mode',
  'bundle',
  'exclude',
  'operators',
  'componentValues',
  'featureFlags',
  'imageTags',
  'chartVersions',
]);
const tenantPatch = object({
  exclude: array(string()).optional(),
  featureFlags: record(string().regex(/^[a-z][\d_a-z]{0,63}$/), string().regex(/^(true|false)$/))
    .refine((flags) => Object.keys(flags).length <= 128)
    .optional(),
}).strict();

const stackPath = (ctx: ManagementApiRouterContext) => {
  const { namespace = '', name = '' } = ctx.params;
  if (!kubeName.test(namespace) || !kubeName.test(name)) {
    ctx.status = 400;
    ctx.body = { code: 'kubo.invalid_name', message: 'Invalid stack name' };
    return;
  }
  return `/api/stacks/${namespace}/${name}`;
};

/** Errors never reflect upstream payloads (which can contain credentials or Kubernetes diagnostics). */
const respond = async (
  ctx: ManagementApiRouterContext,
  response: Response,
  format: 'json' | 'yaml' | 'message' = 'json'
) => {
  if (!response.ok) {
    await response.body?.cancel();
    ctx.status = [400, 401, 403, 404, 409, 413, 503].includes(response.status)
      ? response.status
      : 502;
    ctx.body = { code: 'kubo.upstream_error', message: 'Kubo request could not be completed.' };
    return;
  }
  try {
    const text = await readBoundedResponse(response, { maxBytes: 5 * 1024 * 1024 });
    if (response.status === 204) {
      ctx.status = 204;
      return;
    }
    const body = format === 'json' ? safeParseJson(text) : { [format]: text };
    if (body === undefined) {
      ctx.status = 502;
      ctx.body = { code: 'kubo.upstream_error', message: 'Invalid Kubo response.' };
      return;
    }
    ctx.status = response.status;
    ctx.body = body;
  } catch {
    ctx.status = 502;
    ctx.body = { code: 'kubo.upstream_error', message: 'Invalid Kubo response.' };
  }
};

export default function kuboRoutes<T extends ManagementApiRouter>(
  ...[router, tenant]: RouterInitArgs<T>
) {
  // This also protects validation failures and capability responses from shared caching.
  router.use('/kubo', async (ctx, next) => {
    ctx.set('Cache-Control', 'private, no-store');
    return next();
  });
  const forward = async (
    ctx: ManagementApiRouterContext,
    path: string,
    method = 'GET',
    body?: string | BodyInit
  ) => {
    const access = await resolveKuboAccess(tenant, ctx);
    await respond(ctx, await requestKubo(ctx, access, { path, method, body }));
  };
  router.get('/kubo/access', async (ctx, next) => {
    const access = await resolveKuboAccess(tenant, ctx);
    const response = await requestKubo(ctx, access, {
      path: '/api/console/readiness',
      method: 'GET',
    });
    if (!response.ok) {
      await respond(ctx, response);
      return next();
    }
    try {
      const text = await readBoundedResponse(response, { maxBytes: 1024 });
      const readiness = readinessBody.safeParse(safeParseJson(text));
      if (response.status !== 200 || !readiness.success) {
        throw new Error('Invalid readiness');
      }
      const { tenantMutationsEnabled } = readiness.data;
      ctx.body = {
        canViewAll: access.canViewAll,
        operator: access.operator,
        tenantScoped: !access.operator,
        canMutate: !ctx.auth.isReadOnly && (access.operator || tenantMutationsEnabled),
        tenantMutationsEnabled,
      };
    } catch {
      ctx.status = 502;
      ctx.body = { code: 'kubo.upstream_error', message: 'Invalid Kubo response.' };
    }
    return next();
  });
  for (const [path, upstream] of [
    ['stacks', '/api/stacks'],
    ['templates', '/api/templates'],
    ['cluster/economics', '/api/cluster/economics'],
    ['demorequests', '/api/demorequests'],
  ] as const) {
    router.get(`/kubo/${path}`, async (ctx, next) => {
      await forward(ctx, upstream);
      return next();
    });
  }
  // The capacity map is a cluster-wide read every tenant may see. Per-node pricing stays
  // operator-only: a price list is commercial data, not capacity.
  router.get('/kubo/kshows', async (ctx, next) => {
    const access = await resolveKuboAccess(tenant, ctx);
    await respond(ctx, await requestKubo(ctx, access, { path: '/api/kshows/snapshot' }));
    if (access.operator && ctx.status === 200) {
      ctx.body = await priceKuboCapacity(ctx.body);
    }
    return next();
  });
  for (const view of ['products', 'stats', 'sessions', 'requests'] as const) {
    router.get(`/kubo/agentfw/${view}`, async (ctx, next) => {
      const query = new URLSearchParams(ctx.querystring);
      query.delete('scope');
      await forward(ctx, `/agentfw/api/v1/${view}?${query.toString()}`);
      return next();
    });
  }
  for (const action of ['approve', 'reject'] as const) {
    router.post(`/kubo/demorequests/:name/${action}`, async (ctx, next) => {
      if (!kubeName.test(ctx.params.name ?? '')) {
        ctx.status = 400;
        return next();
      }
      await forward(ctx, `/api/demorequests/${ctx.params.name}/${action}`, 'POST');
      return next();
    });
  }
  router.post('/kubo/airgap/bundle', async (ctx, next) => {
    const name = typeof ctx.query.name === 'string' ? ctx.query.name : '';
    if (!kubeName.test(name)) {
      ctx.status = 400;
      return next();
    }
    const access = await resolveKuboAccess(tenant, ctx);
    await respond(
      ctx,
      await requestKubo(ctx, access, {
        path: `/api/airgap/bundle?${new URLSearchParams({ name }).toString()}`,
        method: 'POST',
        // eslint-disable-next-line no-restricted-syntax -- Node streaming fetch accepts IncomingMessage with duplex:half; DOM BodyInit omits it.
        body: ctx.req as unknown as BodyInit,
      }),
      'message'
    );
    return next();
  });
  router.get('/kubo/template', async (ctx, next) => {
    const query = new URLSearchParams(ctx.querystring);
    query.delete('scope');
    // The backend validates builtin source, mode, provider, namespace binding and collisions.
    const access = await resolveKuboAccess(tenant, ctx);
    await respond(
      ctx,
      await requestKubo(ctx, access, { path: `/api/template?${query.toString()}` }),
      'yaml'
    );
    return next();
  });
  router.get('/kubo/stacks/:namespace/:name', async (ctx, next) => {
    const path = stackPath(ctx);
    if (path) {
      await forward(ctx, path);
    }
    return next();
  });
  router.delete('/kubo/stacks/:namespace/:name', async (ctx, next) => {
    const path = stackPath(ctx);
    if (path) {
      const query = new URLSearchParams({
        confirm: ctx.params.namespace ?? '',
        purge: ctx.query.purge === 'true' ? 'true' : 'false',
      });
      await forward(ctx, `${path}?${query.toString()}`, 'DELETE');
    }
    return next();
  });
  router.patch(
    '/kubo/stacks/:namespace/:name',
    koaGuard({ body: object({}).passthrough() }),
    async (ctx, next) => {
      const path = stackPath(ctx);
      if (!path) {
        return next();
      }
      const access = await resolveKuboAccess(tenant, ctx);
      const { body } = ctx.guard;
      if (
        Object.keys(body).some((key) => !patchFields.has(key)) ||
        (!access.operator && !tenantPatch.safeParse(body).success)
      ) {
        ctx.status = 400;
        ctx.body = { code: 'kubo.invalid_field', message: 'Unsupported stack update.' };
        return next();
      }
      await respond(
        ctx,
        await requestKubo(ctx, access, { path, method: 'PATCH', body: JSON.stringify(body) })
      );
      return next();
    }
  );
  for (const action of ['bootstrap', 'reconcile'] as const) {
    router.post(`/kubo/stacks/:namespace/:name/${action}`, async (ctx, next) => {
      const path = stackPath(ctx);
      if (path) {
        await forward(ctx, `${path}/${action}`, 'POST');
      }
      return next();
    });
  }
  router.post(
    '/kubo/stacks/:namespace/:name/pause',
    koaGuard({ body: object({ paused: boolean() }).strict() }),
    async (ctx, next) => {
      const path = stackPath(ctx);
      if (path) {
        await forward(ctx, `${path}/pause`, 'POST', JSON.stringify(ctx.guard.body));
      }
      return next();
    }
  );
  router.post('/kubo/stacks', koaGuard({ body: createStackBody }), async (ctx, next) => {
    const access = await resolveKuboAccess(tenant, ctx);
    const { body } = ctx.guard;
    if (
      !access.operator &&
      (!['full', 'lite', 'v1'].includes(body.template) ||
        (body.mode !== undefined && body.mode !== 'Direct') ||
        (body.authProvider !== undefined && body.authProvider !== 'logto') ||
        body.operators !== undefined)
    ) {
      ctx.status = 400;
      ctx.body = {
        code: 'kubo.invalid_field',
        message: 'Unsupported tenant provisioning options.',
      };
      return next();
    }
    // `tenant` is a DNS namespace slug; owner is ONLY access.tenantId in the signed proof.
    await respond(
      ctx,
      await requestKubo(ctx, access, {
        path: '/api/stacks',
        method: 'POST',
        body: JSON.stringify(body),
      })
    );
    return next();
  });
}

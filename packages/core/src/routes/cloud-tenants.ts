import { buildOrganizationUrn } from '@logto/core-kit';
import {
  adminTenantId,
  CloudScope,
  getCloudApiIndicator,
  getTenantOrganizationId,
  PredefinedScope,
  TenantTag,
} from '@logto/schemas';
import { sql } from '@silverhand/slonik';
import type { Context } from 'koa';
import Router from 'koa-router';
import { z } from 'zod';

import { EnvSet, getTenantEndpoint } from '#src/env-set/index.js';
import RequestError from '#src/errors/RequestError/index.js';
import { verifyBearerTokenFromRequest } from '#src/middleware/koa-auth/index.js';
import koaGuard from '#src/middleware/koa-guard.js';
import { provisionTenant } from '#src/tenants/provision.js';
import assertThat from '#src/utils/assert-that.js';

// Cloud tenant API: list, read and create tenants on this instance. Served on the admin tenant's `/api`
// only when `IS_CLOUD` is set. A caller needs a token issued for the instance's own cloud API resource,
// `<admin endpoint>/api`, and the scope for the route.

type TenantMemberRow = {
  id: string;
  name: string | undefined;
  username: string | undefined;
  primaryEmail: string | undefined;
  primaryPhone: string | undefined;
  avatar: string | undefined;
  organizationRoles: Array<{ id: string; name: string; description: string | undefined }>;
};

type TenantRow = {
  id: string;
  name: string;
  tag: string;
  regionName: string | undefined;
  createdAt: string | number | Date;
};

const toTenantResponse = (row: TenantRow) => {
  const createdAt = new Date(row.createdAt).toISOString();

  return {
    id: row.id,
    name: row.name,
    tag: row.tag,
    indicator: getCloudApiIndicator(getTenantEndpoint(row.id, EnvSet.values).origin),
    subscription: {
      status: 'active',
      planId: 'development',
      currentPeriodStart: createdAt,
      currentPeriodEnd: new Date(Date.parse(createdAt) + 30 * 24 * 60 * 60 * 1000).toISOString(),
      isEnterprisePlan: false,
      quotaScope: 'dedicated',
    },
    usage: { activeUsers: 0, tokenUsage: 0, userTokenUsage: 0, m2mTokenUsage: 0 },
    quota: { mauLimit: null, tokenLimit: null },
    openInvoices: [],
    isSuspended: false,
    planId: 'development',
    regionName: row.regionName ?? 'local',
    createdAt,
  };
};

const createTenantBody = z.object({
  name: z.string().min(1).max(128),
  tag: z.nativeEnum(TenantTag),
  regionName: z.string().max(64).optional(),
});

export const cloudTenantRoutes = (envSet: EnvSet) => {
  const router = new Router();

  // Checks the bearer token against the instance's cloud API resource and the route's scope, and returns
  // the user it was issued to. Only a signed-in user can own a tenant, so a machine token is refused.
  const authenticate = async (ctx: Context, scope: CloudScope) => {
    const audience = getCloudApiIndicator(EnvSet.values.adminUrlSet.endpoint.origin);
    const { sub, clientId, scopes } = await verifyBearerTokenFromRequest(
      envSet,
      ctx.request,
      audience
    );

    assertThat(
      scopes.includes(PredefinedScope.All) || scopes.includes(scope),
      new RequestError({ code: 'auth.forbidden', status: 403 })
    );
    assertThat(sub !== clientId, new RequestError({ code: 'auth.forbidden', status: 403 }));

    return sub;
  };

  // The members list is read with the console's organization token for the tenant. The caller is still
  // checked against that organization's members below, so the fallback only changes which token is accepted.
  const authenticateTenantMember = async (ctx: Context, tenantId: string) => {
    try {
      return await authenticate(ctx, CloudScope.ManageTenantSelf);
    } catch {
      const { sub } = await verifyBearerTokenFromRequest(
        envSet,
        ctx.request,
        buildOrganizationUrn(getTenantOrganizationId(tenantId))
      );

      return sub;
    }
  };

  router.get('/api/tenants', koaGuard({ status: [200, 304, 401, 403] }), async (ctx, next) => {
    const pool = await EnvSet.sharedPool;
    const userId = await authenticate(ctx, CloudScope.ManageTenantSelf);

    // The admin tenant is the instance's own console. Only its operator, who holds the admin role there,
    // sees it in the list. Every other user, including Cloud customers, sees customer tenants only.
    const operator = await pool.maybeOne<{ userId: string }>(sql`
        select ur.user_id as "userId"
        from users_roles ur
        join roles r on r.id = ur.role_id
        where ur.tenant_id = ${adminTenantId} and ur.user_id = ${userId} and r.name = 'admin'
        limit 1
      `);

    const rows = await pool.any<TenantRow>(sql`
        select id, name, tag, region_name as "regionName", created_at as "createdAt"
        from tenants
        where id <> ${adminTenantId} or ${Boolean(operator)}
        order by created_at
      `);
    ctx.body = rows.map((row) => toTenantResponse(row));

    return next();
  });

  router.get(
    '/api/tenants/:tenantId',
    koaGuard({ status: [200, 304, 401, 403, 404] }),
    async (ctx, next) => {
      await authenticate(ctx, CloudScope.ManageTenantSelf);
      const pool = await EnvSet.sharedPool;

      const row = await pool.maybeOne<TenantRow>(sql`
        select id, name, tag, region_name as "regionName", created_at as "createdAt"
        from tenants
        where id = ${ctx.params.tenantId ?? ''} and id <> ${adminTenantId}
      `);
      assertThat(row, new RequestError({ code: 'entity.not_found', status: 404 }));
      ctx.body = toTenantResponse(row);

      return next();
    }
  );

  // Members of a tenant are the users in its organization in the admin tenant. A caller sees the list only
  // when they are a member themselves, so one tenant's members are not visible to other users.
  router.get(
    '/api/tenants/:tenantId/members',
    koaGuard({ status: [200, 304, 401, 403] }),
    async (ctx, next) => {
      const userId = await authenticateTenantMember(ctx, ctx.params.tenantId ?? '');
      const organizationId = getTenantOrganizationId(ctx.params.tenantId ?? '');
      const pool = await EnvSet.sharedPool;

      const caller = await pool.maybeOne<{ userId: string }>(sql`
        select user_id as "userId"
        from organization_user_relations
        where tenant_id = ${adminTenantId}
          and organization_id = ${organizationId}
          and user_id = ${userId}
      `);
      assertThat(caller, new RequestError({ code: 'auth.forbidden', status: 403 }));

      const rows = await pool.any<TenantMemberRow>(sql`
        select
          u.id,
          u.name,
          u.username,
          u.primary_email as "primaryEmail",
          u.primary_phone as "primaryPhone",
          u.avatar,
          coalesce(
            (
              select json_agg(json_build_object('id', r.id, 'name', r.name, 'description', r.description))
              from organization_role_user_relations rr
              join organization_roles r
                on r.tenant_id = rr.tenant_id and r.id = rr.organization_role_id
              where rr.tenant_id = ${adminTenantId}
                and rr.organization_id = ${organizationId}
                and rr.user_id = u.id
            ),
            '[]'
          ) as "organizationRoles"
        from organization_user_relations m
        join users u on u.tenant_id = m.tenant_id and u.id = m.user_id
        where m.tenant_id = ${adminTenantId} and m.organization_id = ${organizationId}
        order by u.created_at
      `);
      // This response ends the chain. Calling next() would let the billing API's catch-all for
      // `/api/tenants/*` overwrite the members with its 404.
      ctx.body = rows;
    }
  );

  router.post(
    '/api/tenants',
    koaGuard({ body: createTenantBody, status: [201, 400, 401, 403] }),
    async (ctx, next) => {
      const userId = await authenticate(ctx, CloudScope.CreateTenant);
      const { name, tag, regionName } = ctx.guard.body;
      const pool = await EnvSet.sharedPool;
      const tenantId = await provisionTenant({ name, tag, regionName, creatorId: userId });
      const row = await pool.one<TenantRow>(sql`
        select id, name, tag, region_name as "regionName", created_at as "createdAt"
        from tenants
        where id = ${tenantId}
      `);
      ctx.status = 201;
      ctx.body = toTenantResponse(row);

      return next();
    }
  );

  return router;
};

import { adminTenantId, CloudScope, getCloudApiIndicator, PredefinedScope } from '@logto/schemas';
import { sql } from '@silverhand/slonik';
import type { Context } from 'koa';
import Router from 'koa-router';

import { EnvSet } from '#src/env-set/index.js';
import RequestError from '#src/errors/RequestError/index.js';
import { verifyBearerTokenFromRequest } from '#src/middleware/koa-auth/index.js';
import assertThat from '#src/utils/assert-that.js';

// Leads from the landing demo chat, for the Leads page in the console. Read-only in v1: the list shows
// the lead fields only, and a session's transcript is loaded on its own. Admin tenant only, behind the
// dev-feature flag, and only for a Cloud API token carrying the landing page scope. The list never
// includes transcripts, so a page of leads does not pull whole conversations.

const defaultPageSize = 50;
const maxPageSize = 100;

type LeadRow = {
  id: string;
  sessionId: string;
  lead: Record<string, unknown>;
  emailStatus: string;
  status: string;
  createdAt: string | number | Date;
};

const toPageNumber = (value: unknown, fallback: number, max: number) => {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.min(parsed, max);
};

export const landingPageLeadRoutes = (envSet: EnvSet) => {
  const router = new Router();

  // The same authorization as the landing page editor: a Cloud API token for this instance with the
  // landing page scope, issued to a user rather than a machine client.
  const authenticateAdmin = async (ctx: Context) => {
    const audience = getCloudApiIndicator(EnvSet.values.adminUrlSet.endpoint.origin);
    const { sub, clientId, scopes } = await verifyBearerTokenFromRequest(
      envSet,
      ctx.request,
      audience
    );

    assertThat(
      scopes.includes(PredefinedScope.All) || scopes.includes(CloudScope.ManageLandingPage),
      new RequestError({ code: 'auth.forbidden', status: 403 })
    );
    assertThat(sub !== clientId, new RequestError({ code: 'auth.forbidden', status: 403 }));
  };

  // Behind the dev-feature flag: without it the routes do not exist for the caller.
  const assertDevFeature = () => {
    assertThat(
      EnvSet.values.isDevFeaturesEnabled,
      new RequestError({ code: 'entity.not_found', status: 404 })
    );
  };

  router.get('/api/landing-leads', async (ctx, next) => {
    assertDevFeature();
    await authenticateAdmin(ctx);

    const limit = toPageNumber(ctx.query.limit, defaultPageSize, maxPageSize) || defaultPageSize;
    const offset = toPageNumber(ctx.query.offset, 0, Number.MAX_SAFE_INTEGER);
    const pool = await EnvSet.sharedPool;
    const leads = await pool.any<LeadRow>(sql`
      select
        id,
        session_id as "sessionId",
        lead,
        email_status as "emailStatus",
        status,
        created_at as "createdAt"
      from landing_leads
      where tenant_id = ${adminTenantId}
      order by created_at desc, id desc
      limit ${limit}
      offset ${offset}
    `);

    ctx.body = { leads };

    return next();
  });

  router.get('/api/landing-leads/:sessionId/transcript', async (ctx, next) => {
    assertDevFeature();
    await authenticateAdmin(ctx);

    const sessionId = typeof ctx.params.sessionId === 'string' ? ctx.params.sessionId : '';
    const pool = await EnvSet.sharedPool;
    const session = await pool.maybeOne<{ messages: unknown }>(sql`
      select messages
      from landing_chat_sessions
      where tenant_id = ${adminTenantId}
        and session_id = ${sessionId}
    `);

    assertThat(session, new RequestError({ code: 'entity.not_found', status: 404 }));
    ctx.body = { messages: session.messages };

    return next();
  });

  return router;
};

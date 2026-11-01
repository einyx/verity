import { adminTenantId } from '@logto/schemas';
import { type CommonQueryMethods, sql } from '@silverhand/slonik';
import { type Context } from 'koa';
import { koaBody } from 'koa-body';
import type Router from 'koa-router';

import { EnvSet } from '#src/env-set/index.js';
import { readAcsMailConfig } from '#src/libraries/acs-mail.js';

import { createSharedHitStore } from './landing-page-chat-counters.js';
import { createWindowLimiter } from './landing-page-chat-guard.js';
import { createFollowUpStore } from './landing-page-lead-follow-up-store.js';
import { sendLeadFollowUp, type FollowUpCode } from './landing-page-lead-follow-up.js';

const errorStatus: Record<FollowUpCode, number> = {
  invalid_input: 400,
  contact_not_allowed: 403,
  unconfigured: 503,
  conflict: 409,
  processing: 409,
  rate_limited: 429,
  unknown: 502,
};

export const mountLeadFollowUpRoute = (
  router: Router,
  authenticate: (ctx: Context) => Promise<string>,
  getPool: () => Promise<CommonQueryMethods>
) => {
  const limiter = createWindowLimiter(20, 60 * 60_000, { store: createSharedHitStore(getPool) });
  router.post(
    '/api/landing-leads/:sessionId/follow-up',
    koaBody({ jsonLimit: '16kb', formLimit: '16kb', textLimit: '16kb', multipart: false }),
    async (ctx, next) => {
      // Lead follow-up email remains a reviewed, in-development administrator action.
      if (!EnvSet.values.isDevFeaturesEnabled) {
        ctx.status = 404;
        return next();
      }
      const userId = await authenticate(ctx);
      const sessionId = typeof ctx.params.sessionId === 'string' ? ctx.params.sessionId : '';
      const pool = await getPool();
      const row = await pool.maybeOne<{
        lead: unknown;
        companyProfile?: { syntheticContact?: boolean; researchStatus?: string; domain?: string };
        tags?: string[];
      }>(sql`
      select lead, company_profile as "companyProfile", tags
      from landing_leads where tenant_id = ${adminTenantId} and session_id = ${sessionId}
    `);
      if (!row) {
        ctx.status = 404;
        ctx.body = { error: 'lead_not_found' };
        return next();
      }
      const result = await sendLeadFollowUp({
        store: createFollowUpStore(pool),
        userId,
        sessionId,
        lead: row.lead,
        isSynthetic: row.companyProfile?.syntheticContact === true,
        profile: row.companyProfile,
        tags: row.tags,
        body: ctx.request.body,
        config: readAcsMailConfig(),
        now: new Date(),
        allowSend: async () => limiter.allow(`lead-follow-up:${userId}`),
      });
      ctx.status = result.ok ? 202 : errorStatus[result.code];
      ctx.body = result.ok
        ? { status: result.status, requestId: result.requestId }
        : { error: result.code };
      return next();
    }
  );
};

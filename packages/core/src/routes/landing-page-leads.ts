import { adminTenantId, CloudScope, getCloudApiIndicator, PredefinedScope } from '@logto/schemas';
import { sql } from '@silverhand/slonik';
import type { Context } from 'koa';
import Router from 'koa-router';

import { EnvSet } from '#src/env-set/index.js';
import RequestError from '#src/errors/RequestError/index.js';
import { verifyBearerTokenFromRequest } from '#src/middleware/koa-auth/index.js';
import assertThat from '#src/utils/assert-that.js';

import { type BriefInput, renderBriefPdf } from './landing-page-brief.js';
import { type LeadFileKind, verifyLeadFileQuery } from './landing-page-signed.js';
import { buildSlidesDeck } from './landing-page-slides.js';

type BriefLead = BriefInput['lead'];

// Leads from the landing demo chat, for the Leads page in the console. Read-only in v1: the list shows
// the lead fields only, and a session's transcript is loaded on its own. Admin tenant only, and only for
// a Cloud API token carrying the landing page scope. The list never includes transcripts, so a page of
// leads does not pull whole conversations.

const defaultPageSize = 50;
const maxPageSize = 100;

type LeadRow = {
  id: string;
  sessionId: string;
  lead: Record<string, unknown>;
  emailStatus: string;
  status: string;
  companyProfile: Record<string, unknown> | undefined;
  createdAt: string | number | Date;
};

const toPageNumber = (value: unknown, fallback: number, max: number) => {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.min(parsed, max);
};

/** The brief input for one stored lead, or undefined when there is no such lead in the admin tenant. */
const loadBriefInput = async (sessionId: string): Promise<BriefInput | undefined> => {
  const pool = await EnvSet.sharedPool;
  const row = await pool.maybeOne<{
    lead: Record<string, unknown>;
    companyProfile: Record<string, unknown> | undefined;
  }>(sql`
    select lead, company_profile as "companyProfile"
    from landing_leads
    where tenant_id = ${adminTenantId}
      and session_id = ${sessionId}
  `);

  if (!row) {
    return undefined;
  }

  return {
    // eslint-disable-next-line no-restricted-syntax -- The stored lead is validated before it is saved.
    lead: row.lead as unknown as BriefLead,
    // eslint-disable-next-line no-restricted-syntax -- The stored profile is written by this service only.
    profile: (row.companyProfile ?? undefined) as BriefInput['profile'],
  };
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

  router.get('/api/landing-leads', async (ctx, next) => {
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
        company_profile as "companyProfile",
        created_at as "createdAt"
      from landing_leads
      where tenant_id = ${adminTenantId}
      order by created_at desc, id desc
      limit ${limit}
      offset ${offset}
    `);

    // The scheduling link for "book a meeting" comes from configuration; without it the console hides the button.
    ctx.body = { leads, bookingUrl: process.env.LANDING_LEAD_BOOKING_URL ?? null };

    return next();
  });

  router.get('/api/landing-leads/:sessionId/transcript', async (ctx, next) => {
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

  router.get('/api/landing-leads/:sessionId/brief.pdf', async (ctx, next) => {
    await authenticateAdmin(ctx);

    const sessionId = typeof ctx.params.sessionId === 'string' ? ctx.params.sessionId : '';
    const pool = await EnvSet.sharedPool;
    const row = await pool.maybeOne<{
      lead: Record<string, unknown>;
      companyProfile: Record<string, unknown> | undefined;
    }>(sql`
      select lead, company_profile as "companyProfile"
      from landing_leads
      where tenant_id = ${adminTenantId}
        and session_id = ${sessionId}
    `);

    assertThat(row, new RequestError({ code: 'entity.not_found', status: 404 }));

    const pdf = await renderBriefPdf({
      // The lead's fields were validated when the lead was saved, so they are read as stored.
      // eslint-disable-next-line no-restricted-syntax -- The stored lead is validated before it is saved.
      lead: row.lead as unknown as BriefLead,
      // eslint-disable-next-line no-restricted-syntax -- The stored profile is written by this service only.
      profile: (row.companyProfile ?? undefined) as BriefInput['profile'],
      bookingUrl: process.env.LANDING_LEAD_BOOKING_URL,
    });

    ctx.set('content-type', 'application/pdf');
    ctx.set('content-disposition', `attachment; filename="meeting-brief-${sessionId}.pdf"`);
    ctx.body = pdf;

    return next();
  });

  // The meeting slides for a lead, built from the same stored lead and company profile as the brief.
  router.get('/api/landing-leads/:sessionId/slides.pptx', async (ctx, next) => {
    await authenticateAdmin(ctx);

    const sessionId = typeof ctx.params.sessionId === 'string' ? ctx.params.sessionId : '';
    const pool = await EnvSet.sharedPool;
    const row = await pool.maybeOne<{
      lead: Record<string, unknown>;
      companyProfile: Record<string, unknown> | undefined;
    }>(sql`
      select lead, company_profile as "companyProfile"
      from landing_leads
      where tenant_id = ${adminTenantId}
        and session_id = ${sessionId}
    `);

    assertThat(row, new RequestError({ code: 'entity.not_found', status: 404 }));

    const deck = await buildSlidesDeck(
      {
        // The stored lead and profile are validated or written by this service, as for the brief.
        // eslint-disable-next-line no-restricted-syntax -- The stored lead is validated before it is saved.
        lead: row.lead as unknown as BriefLead,
        // eslint-disable-next-line no-restricted-syntax -- The stored profile is written by this service only.
        profile: (row.companyProfile ?? undefined) as BriefInput['profile'],
        bookingUrl: process.env.LANDING_LEAD_BOOKING_URL,
      },
      new Date().toISOString().slice(0, 10)
    );

    ctx.set(
      'content-type',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    );
    ctx.set('content-disposition', `attachment; filename="meeting-slides-${sessionId}.pptx"`);
    ctx.body = deck;

    return next();
  });

  // Signed download for the Slack message's buttons. The signature replaces the admin token, which Slack
  // cannot carry. The link stops working after seven days.
  router.get('/api/landing-lead-files/:kind/:sessionId', async (ctx, next) => {
    const { kind } = ctx.params;
    const sessionId = typeof ctx.params.sessionId === 'string' ? ctx.params.sessionId : '';
    const secret = process.env.LANDING_LEAD_LINK_SECRET;

    assertThat(
      kind === 'brief' || kind === 'slides',
      new RequestError({ code: 'entity.not_found', status: 404 })
    );
    assertThat(secret, new RequestError({ code: 'entity.not_found', status: 404 }));

    const query = {
      expires: typeof ctx.query.expires === 'string' ? ctx.query.expires : undefined,
      sig: typeof ctx.query.sig === 'string' ? ctx.query.sig : undefined,
    };
    const fileKind: LeadFileKind = kind;

    assertThat(
      verifyLeadFileQuery(secret, fileKind, sessionId, query),
      new RequestError({ code: 'auth.forbidden', status: 403 })
    );

    const input = await loadBriefInput(sessionId);

    assertThat(input, new RequestError({ code: 'entity.not_found', status: 404 }));

    if (fileKind === 'brief') {
      const pdf = await renderBriefPdf({ ...input, bookingUrl: process.env.LANDING_LEAD_BOOKING_URL });
      ctx.set('content-type', 'application/pdf');
      ctx.set('content-disposition', `attachment; filename="meeting-brief-${sessionId}.pdf"`);
      ctx.body = pdf;
    } else {
      const date = new Date().toISOString().slice(0, 10);
      ctx.set(
        'content-type',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      );
      ctx.set('content-disposition', `attachment; filename="meeting-slides-${sessionId}.pptx"`);
      ctx.body = await buildSlidesDeck(
        { ...input, bookingUrl: process.env.LANDING_LEAD_BOOKING_URL },
        date
      );
    }

    return next();
  });

  return router;
};

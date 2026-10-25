/* eslint-disable @silverhand/fp/no-mutation -- The in-memory tables are the test's fake database, so they are reassigned per test and read back by the assertions. */
/* eslint-disable max-lines -- Shared route authorization and isolated fake database cover analytics and both export paths. */
import Koa from 'koa';
import request from 'supertest';

import { type BriefInput } from './landing-page-brief.js';
import { parseBudgetAssessment } from './landing-page-budget.js';
import type { DailyLeadCount, LeadStageBucket } from './landing-page-lead-stats.js';
import { signLeadFileQuery } from './landing-page-signed.js';

const { jest } = import.meta;

type Row = Record<string, unknown>;

// An in-memory stand-in for the two admin-tenant tables the leads routes read. It answers each query by
// its SQL text, so the list and transcript routes run for real against known rows.
const state: {
  leads: Row[];
  sessions: Row[];
  lastListLimit: number;
  lastQuery: { sql: string; values: unknown[] } | undefined;
  lastCountQuery: { sql: string; values: unknown[] } | undefined;
  stageRows: Array<Omit<LeadStageBucket, 'stage'> & { status: string }>;
  dailyRows: DailyLeadCount[];
  statsQueries: Array<{ sql: string; values: unknown[] }>;
  exportQueries: Array<{ sql: string; values: unknown[] }>;
  exportRow: Row | undefined;
} = {
  leads: [],
  sessions: [],
  lastListLimit: 0,
  lastQuery: undefined,
  lastCountQuery: undefined,
  stageRows: [],
  dailyRows: [],
  statsQueries: [],
  exportQueries: [],
  exportRow: undefined,
};

const fakePool = {
  one: async (query: { sql: string; values: unknown[] }) => {
    state.lastCountQuery = query;
    return { total: state.leads.length };
  },
  any: async (query: { sql: string; values: unknown[] }) => {
    state.lastQuery = query;
    if (query.sql.includes('group by status')) {
      state.statsQueries = [...state.statsQueries, query];
      return state.stageRows;
    }
    if (query.sql.includes('to_char(')) {
      state.statsQueries = [...state.statsQueries, query];
      return state.dailyRows;
    }
    if (query.sql.includes('from landing_leads')) {
      // The tenant id is the first parameter; limit and offset are the last two.
      const limit = Number(query.values.at(-2));
      const offset = Number(query.values.at(-1));
      state.lastListLimit = limit;
      const selected = state.leads
        .slice()
        .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
        .slice(offset, offset + limit);
      return selected;
    }
    return [];
  },
  maybeOne: async (query: { sql: string; values: unknown[] }) => {
    state.lastQuery = query;
    state.exportQueries = [...state.exportQueries, query];
    if (query.sql.includes('update landing_leads') && query.sql.includes('returning id')) {
      return { id: 'lead-1' };
    }
    if (query.sql.includes('from landing_leads')) {
      return state.exportRow;
    }
    if (query.sql.includes('from landing_chat_sessions')) {
      const sessionId = query.values.at(-1);
      return state.sessions.find((row) => row.session_id === sessionId);
    }
  },
};

const env = { isDevFeaturesEnabled: true };
const auth = {
  scopes: ['manage:landing:page'] as string[],
  token: { sub: 'user-1', clientId: 'console-app' },
};

jest.unstable_mockModule('#src/env-set/index.js', () => ({
  EnvSet: {
    get values() {
      return {
        adminUrlSet: { endpoint: new URL('https://admin.example.com') },
        cloudUrlSet: { endpoint: new URL('https://cloud.example.com') },
        isDevFeaturesEnabled: env.isDevFeaturesEnabled,
        isProduction: false,
        isUnitTest: true,
      };
    },
    sharedPool: Promise.resolve(fakePool),
  },
}));

jest.unstable_mockModule('#src/middleware/koa-auth/index.js', () => ({
  verifyBearerTokenFromRequest: async () => ({ ...auth.token, scopes: auth.scopes }),
}));

const renderPdf = jest.fn(
  async (_input: BriefInput) => new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55])
);
const renderSlides = jest.fn(async (_input: BriefInput) => Buffer.from('PK synthetic deck'));
jest.unstable_mockModule('./landing-page-slides.js', () => ({ buildSlidesDeck: renderSlides }));
jest.unstable_mockModule('./landing-page-brief.js', () => ({
  // Real PDF bytes, as the renderer returns them: a Uint8Array.
  renderBriefPdf: renderPdf,
}));

const { landingPageLeadRoutes } = await import('./landing-page-leads.js');

const createApp = () => {
  const app = new Koa();
  app.use(async (ctx, next) => {
    try {
      await next();
    } catch (error: unknown) {
      ctx.status = (error as { status?: number }).status ?? 500;
      ctx.body = { message: (error as Error).message };
    }
  });
  app.use(landingPageLeadRoutes({} as never).routes());
  return app.callback();
};

const get = (path: string) => request(createApp()).get(path).set('Authorization', 'Bearer test');
const patch = (path: string, body: Record<string, unknown>) =>
  request(createApp()).patch(path).set('Authorization', 'Bearer test').send(body);

const lead = (index: number): Row => ({
  id: `lead-${index}`,
  sessionId: `session-${index}`,
  lead: { firstName: `Visitor${index}`, lastName: 'Test', email: `v${index}@example.com` },
  emailStatus: 'sent',
  status: 'new',
  notes: `Note for visitor ${index}`,
  tags: [`tag-${index}`],
  createdAt: new Date(2026, 9, index).toISOString(),
});

beforeEach(() => {
  state.exportQueries = [];
  state.exportRow = { lead: { firstName: 'Ada' }, companyProfile: undefined };
  renderPdf.mockClear();
  renderSlides.mockClear();
  state.statsQueries = [];
  state.stageRows = [
    { status: 'future-b', count: 2, last7Days: 1, previous7Days: 0 },
    { status: 'qualified', count: 4, last7Days: 2, previous7Days: 1 },
    { status: 'new', count: 3, last7Days: 1, previous7Days: 2 },
    { status: 'future-a', count: 1, last7Days: 0, previous7Days: 1 },
  ];
  state.dailyRows = [{ day: '2026-10-13', count: 3 }];
  state.lastQuery = undefined;
  state.lastCountQuery = undefined;
  env.isDevFeaturesEnabled = true;
  auth.scopes = ['manage:landing:page'];
  auth.token = { sub: 'user-1', clientId: 'console-app' };
  state.leads = [lead(1), lead(2), lead(3)];
  state.sessions = [
    {
      session_id: 'session-2',
      messages: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
      ],
    },
  ];
});

describe('landing leads routes', () => {
  it('shares selected admin-tenant export context across direct and signed downloads without writes', async () => {
    state.exportRow = {
      lead: {
        firstName: 'Ada',
        lastName: 'Example',
        company: 'Air Example',
        email: 'ada@example.invalid',
      },
      companyProfile: {
        summary: 'Regional carrier',
        syntheticContact: true,
        researchStatus: 'fixture',
      },
      notes: 'Saved private note',
      status: 'qualified',
      tags: ['synthetic'],
    };
    const previousSecret = process.env.LANDING_LEAD_LINK_SECRET;
    process.env.LANDING_LEAD_LINK_SECRET = 'unit-test-only-not-a-real-secret';
    try {
      for (const kind of ['brief', 'slides'] as const) {
        const extension = kind === 'brief' ? 'brief.pdf' : 'slides.pptx';
        // eslint-disable-next-line no-await-in-loop -- Serial requests keep fake database evidence deterministic.
        const directResponse = await get(`/api/landing-leads/session-2/${extension}`);
        expect(directResponse.status).toBe(200);
        const query = signLeadFileQuery('unit-test-only-not-a-real-secret', kind, 'session-2');
        // eslint-disable-next-line no-await-in-loop -- Verify each signed variant after its direct counterpart.
        const signedResponse = await get(`/api/landing-lead-files/${kind}/session-2?${query}`);
        expect(signedResponse.status).toBe(200);
      }
    } finally {
      if (previousSecret === undefined) {
        // eslint-disable-next-line @silverhand/fp/no-delete -- Restore original absence of the test-only environment variable.
        delete process.env.LANDING_LEAD_LINK_SECRET;
      } else {
        process.env.LANDING_LEAD_LINK_SECRET = previousSecret;
      }
    }
    for (const renderer of [renderPdf, renderSlides]) {
      expect(renderer).toHaveBeenCalledTimes(2);
      for (const [input] of renderer.mock.calls) {
        expect(input.exportContext).toEqual({
          notes: 'Saved private note',
          status: 'qualified',
          tags: ['synthetic'],
          transcript: [
            { role: 'user', content: 'Hi' },
            { role: 'assistant', content: 'Hello' },
          ],
        });
        expect(input.profile).toMatchObject({ syntheticContact: true, researchStatus: 'fixture' });
      }
    }
    expect(state.exportQueries).toHaveLength(8);
    for (const query of state.exportQueries) {
      expect(query.sql).toContain('tenant_id =');
      expect(query.sql).toContain('session_id =');
      expect(query.values.at(-1)).toBe('session-2');
      expect(query.sql).not.toMatch(/\b(update|insert|delete)\b/i);
    }
  });

  it('does not load any transcript when the selected lead does not exist', async () => {
    state.exportRow = undefined;
    const response = await get('/api/landing-leads/missing/brief.pdf');
    expect(response.status).toBe(404);
    expect(state.exportQueries).toHaveLength(1);
    expect(renderPdf).not.toHaveBeenCalled();
  });
  describe('stats', () => {
    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout'] });
      jest.setSystemTime(new Date('2026-10-23T12:00:00.000Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('sums every stage, maps status to stage, and stably orders unknown stages last', async () => {
      const response = await get('/api/landing-leads/stats');
      expect(response.status).toBe(200);
      expect(response.body.total).toBe(10);
      expect(response.body.byStage).toEqual([
        { stage: 'new', count: 3, last7Days: 1, previous7Days: 2 },
        { stage: 'qualified', count: 4, last7Days: 2, previous7Days: 1 },
        { stage: 'future-b', count: 2, last7Days: 1, previous7Days: 0 },
        { stage: 'future-a', count: 1, last7Days: 0, previous7Days: 1 },
      ]);
      expect(response.body.byWeek).toHaveLength(12);
      expect(response.body.byWeek[0]).toEqual({ weekStart: '2026-07-27', count: 0 });
      expect(response.body.byWeek[11]).toEqual({ weekStart: '2026-10-12', count: 3 });
      expect(state.statsQueries).toHaveLength(2);
      expect(state.lastCountQuery).toBeUndefined();
    });

    it('constructs tenant-scoped rolling windows and complete UTC day boundaries from one now', async () => {
      await get('/api/landing-leads/stats');
      const [stage, daily] = state.statsQueries;
      expect(stage?.sql).toContain('count(*)::int as count');
      expect(stage?.sql).toContain('count(*) filter (where created_at >=');
      expect(stage?.sql).toContain('and created_at <');
      expect(stage?.sql).toContain('where tenant_id =');
      expect(stage?.values).toEqual([
        '2026-10-16T12:00:00.000Z',
        '2026-10-09T12:00:00.000Z',
        '2026-10-16T12:00:00.000Z',
        'admin',
      ]);
      expect(daily?.sql).toContain("date_trunc('day', created_at at time zone 'utc')");
      expect(daily?.sql).toContain('where tenant_id =');
      expect(daily?.sql).toContain('and created_at >=');
      expect(daily?.sql).toContain('and created_at <');
      expect(daily?.values).toEqual([
        'admin',
        '2026-07-27T00:00:00.000Z',
        '2026-10-19T00:00:00.000Z',
      ]);
    });

    it('returns zero-filled weeks and zero total for no leads', async () => {
      state.stageRows = [];
      state.dailyRows = [];
      const response = await get('/api/landing-leads/stats');
      expect(response.status).toBe(200);
      expect(response.body.total).toBe(0);
      expect(response.body.byStage).toEqual([]);
      expect(response.body.byWeek).toHaveLength(12);
      expect(response.body.byWeek).toEqual(
        expect.arrayContaining([
          { weekStart: '2026-07-27', count: 0 },
          { weekStart: '2026-10-12', count: 0 },
        ])
      );
    });

    it('hides stats with 404 before querying when dev features are off', async () => {
      env.isDevFeaturesEnabled = false;
      const response = await get('/api/landing-leads/stats');
      expect(response.status).toBe(404);
      expect(state.statsQueries).toEqual([]);
    });

    it('refuses missing scope with 403 before querying', async () => {
      auth.scopes = ['read:something-else'];
      const response = await get('/api/landing-leads/stats');
      expect(response.status).toBe(403);
      expect(state.statsQueries).toEqual([]);
    });

    it('refuses machine tokens with 403 even with landing-page scope', async () => {
      auth.token = { sub: 'machine-client', clientId: 'machine-client' };
      const response = await get('/api/landing-leads/stats');
      expect(response.status).toBe(403);
      expect(state.statsQueries).toEqual([]);
    });

    it('accepts the existing all-scope authorization', async () => {
      auth.scopes = ['all'];
      const response = await get('/api/landing-leads/stats');
      expect(response.status).toBe(200);
    });
  });

  it('hides leads endpoints while dev features are off', async () => {
    env.isDevFeaturesEnabled = false;
    const response = await get('/api/landing-leads');
    expect(response.status).toBe(404);
  });

  it('refuses a token without the landing page scope', async () => {
    auth.scopes = ['read:something-else'];
    const response = await get('/api/landing-leads');
    expect(response.status).toBe(403);
  });

  it('refuses a machine token, which has no user to attribute access to', async () => {
    auth.token = { sub: 'machine-client', clientId: 'machine-client' };
    const response = await get('/api/landing-leads');
    expect(response.status).toBe(403);
  });

  it('lists leads newest first without transcripts', async () => {
    const response = await get('/api/landing-leads');
    expect(response.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- supertest types the body as any; the shape is checked here.
    expect(response.body.leads.map((row: Row) => row.id)).toEqual(['lead-3', 'lead-2', 'lead-1']);
    expect(response.body.leads[0]).not.toHaveProperty('messages');
  });

  it('returns no budget figure to the console', async () => {
    const budgetAssessment = parseBudgetAssessment(
      {
        indicativeAnnualRange: { low: 12_000, base: 24_000, high: 48_000 },
        confidence: 'medium',
        rationale: ['Scale context only.'],
        assumptions: ['Scope needs validation.'],
        discoveryQuestions: ['Who approves spend?'],
        evidence: [
          {
            sourceUrl: 'https://budget.example.invalid/about',
            quote: 'A verbatim quote.',
            signal: 'scale context only',
          },
        ],
      },
      {
        company: 'Example Company',
        sources: [{ url: 'https://budget.example.invalid/about', text: 'A verbatim quote.' }],
      },
      new Date('2026-10-24T10:00:00Z')
    );
    state.leads = [
      { ...lead(1), companyProfile: { summary: 'Regional carrier', budgetAssessment } },
      {
        ...lead(2),
        companyProfile: { summary: 'Other carrier', budgetAssessment: { bad: 'shape' } },
      },
    ];

    const response = await get('/api/landing-leads');
    expect(response.status).toBe(200);
    const rows = response.body.leads as Row[];
    const projected = rows.find((row) => row.id === 'lead-1')?.companyProfile;
    const malformed = rows.find((row) => row.id === 'lead-2')?.companyProfile;
    expect(projected).toEqual({
      summary: 'Regional carrier',
      budgetAssessment: {
        opportunityBudgetStatus: 'not_disclosed',
        discoveryQuestions: ['Who approves spend?'],
        evidence: [
          {
            sourceUrl: 'https://budget.example.invalid/about',
            quote: 'A verbatim quote.',
            signal: 'scale context only',
          },
        ],
      },
    });
    // A malformed assessment reads as absent instead of as invented content.
    expect(malformed).toEqual({
      summary: 'Other carrier',
      budgetAssessment: undefined,
    });
    const body = JSON.stringify(response.body);
    for (const forbidden of [
      'USD 150',
      '1,500,000',
      '1500000',
      '12000',
      '24000',
      '48000',
      'Confidence',
      '2026-10-24',
      'demoMonthly',
      'bankAnnualPlanningAnchor',
      'indicativeAnnualRange',
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });

  it('sends the brief as a PDF file, not JSON', async () => {
    const response = await request(createApp())
      .get('/api/landing-leads/session-pdf/brief.pdf')
      .set('Authorization', 'Bearer test')
      .buffer(true)
      .parse((resource, callback) => {
        const chunks: Uint8Array[] = [];
        resource.on('data', (chunk: Uint8Array) => {
          // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- collects the streamed bytes for the assertion
          chunks.push(chunk);
        });
        resource.on('end', () => {
          callback(null, Buffer.concat(chunks));
        });
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(Buffer.from(response.body).toString('latin1').startsWith('%PDF-')).toBe(true);
  });

  it('caps the page size at 100 and defaults it to 50', async () => {
    await get('/api/landing-leads?limit=500');
    expect(state.lastListLimit).toBe(100);

    await get('/api/landing-leads');
    expect(state.lastListLimit).toBe(50);
  });

  it('returns a session transcript', async () => {
    const response = await get('/api/landing-leads/session-2/transcript');
    expect(response.status).toBe(200);
    expect(response.body.messages).toEqual([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
    ]);
  });

  it('returns not found for a session that does not exist', async () => {
    const response = await get('/api/landing-leads/missing/transcript');
    expect(response.status).toBe(404);
  });

  it('updates only validated self-hosted CRM fields', async () => {
    const response = await patch('/api/landing-leads/lead-1', {
      status: 'qualified',
      notes: 'Asked for a demo',
      tags: ['priority'],
    });
    expect(response.status).toBe(200);
    expect(state.lastQuery?.sql).toContain('notes = coalesce');
    expect(state.lastQuery?.sql).toContain('tags = coalesce');
  });

  it('rejects unsupported CRM status and extra properties', async () => {
    const badStatus = await patch('/api/landing-leads/lead-1', { status: 'anything' });
    const extraField = await patch('/api/landing-leads/lead-1', { notes: 'x', stage: 'new' });
    expect(badStatus.status).toBe(400);
    expect(extraField.status).toBe(400);
  });

  it('applies search, status and tag filters using CRM columns', async () => {
    await get('/api/landing-leads?search=ada&stage=qualified&tag=priority');
    expect(state.lastQuery?.sql).toContain('lower(notes)');
    expect(state.lastQuery?.sql).toContain('status =');
    expect(state.lastQuery?.sql).toContain('tags @>');
  });

  it('returns the stored notes and tags and selects both columns', async () => {
    const response = await get('/api/landing-leads');
    expect(response.status).toBe(200);
    expect(response.body.leads[0]).toMatchObject({
      notes: 'Note for visitor 3',
      tags: ['tag-3'],
    });
    const sql = state.lastQuery?.sql ?? '';
    const selectClause = sql.slice(sql.indexOf('select'), sql.indexOf('from landing_leads'));
    expect(selectClause).toContain('notes');
    expect(selectClause).toContain('tags');
  });

  it('searches lead fields, notes and tags case-insensitively', async () => {
    const response = await get('/api/landing-leads?search=NOTE');
    expect(response.status).toBe(200);
    expect(state.lastQuery?.sql).toContain('lower(lead::text) like');
    expect(state.lastQuery?.sql).toContain('lower(notes) like');
    expect(state.lastQuery?.sql).toContain('lower(tags::text) like');
    expect(state.lastQuery?.values.slice(1, -2)).toEqual(['%note%', '%note%', '%note%']);
  });

  it('preserves case-sensitive exact tag filtering alongside additive tag search', async () => {
    const response = await get('/api/landing-leads?tag=Priority&tagSearch=RIOR');
    expect(response.status).toBe(200);
    expect(state.lastQuery?.sql).toContain('tags @>');
    expect(state.lastQuery?.sql).toContain('unnest(tags)');
    expect(state.lastQuery?.sql).toContain('lower(tag) like');
    expect(state.lastQuery?.sql).not.toContain("lead->'tags'");
    expect(state.lastQuery?.values.slice(1, -2)).toEqual(['Priority', '%rior%']);
  });

  it('returns the total count independently of pagination', async () => {
    const response = await get('/api/landing-leads?limit=1&offset=1');
    expect(response.status).toBe(200);
    expect(response.body.leads).toHaveLength(1);
    expect(response.body.totalCount).toBe(3);
    expect(state.lastCountQuery?.sql).toContain('count(*)');
    expect(state.lastCountQuery?.sql).not.toMatch(/limit|offset/);
  });

  it('uses identical tenant and filter predicates for the page and total', async () => {
    const response = await get(
      '/api/landing-leads?search=NOTE&stage=qualified&tag=Priority&tagSearch=RIOR&limit=1'
    );
    expect(response.status).toBe(200);
    const listSql = state.lastQuery?.sql ?? '';
    const countSql = state.lastCountQuery?.sql ?? '';
    expect(countSql.slice(countSql.indexOf('where')).trim()).toBe(
      listSql.slice(listSql.indexOf('where'), listSql.indexOf('order by')).trim()
    );
    expect(state.lastCountQuery?.values).toEqual(state.lastQuery?.values.slice(0, -2));
    expect(state.lastCountQuery?.values.slice(1)).toEqual([
      '%note%',
      '%note%',
      '%note%',
      'qualified',
      'Priority',
      '%rior%',
    ]);
  });

  it('returns a zero total and an empty page when no leads exist', async () => {
    state.leads = [];
    const response = await get('/api/landing-leads');
    expect(response.status).toBe(200);
    expect(response.body.leads).toEqual([]);
    expect(response.body.totalCount).toBe(0);
  });
});

/* eslint-enable @silverhand/fp/no-mutation */
/* eslint-enable max-lines */

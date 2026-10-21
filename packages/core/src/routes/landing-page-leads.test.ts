/* eslint-disable @silverhand/fp/no-mutation -- The in-memory tables are the test's fake database, so they are reassigned per test and read back by the assertions. */
import Koa from 'koa';
import request from 'supertest';

const { jest } = import.meta;

type Row = Record<string, unknown>;

// An in-memory stand-in for the two admin-tenant tables the leads routes read. It answers each query by
// its SQL text, so the list and transcript routes run for real against known rows.
const state: { leads: Row[]; sessions: Row[]; lastListLimit: number } = {
  leads: [],
  sessions: [],
  lastListLimit: 0,
};

const fakePool = {
  any: async (query: { sql: string; values: unknown[] }) => {
    if (query.sql.includes('from landing_leads')) {
      // The tenant id is the first parameter; limit and offset are the last two.
      const limit = Number(query.values.at(-2));
      const offset = Number(query.values.at(-1));
      state.lastListLimit = limit;
      return state.leads
        .slice()
        .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
        .slice(offset, offset + limit);
    }
    return [];
  },
  maybeOne: async (query: { sql: string; values: unknown[] }) => {
    if (query.sql.includes('from landing_chat_sessions')) {
      const sessionId = query.values.at(-1);
      return state.sessions.find((row) => row.session_id === sessionId);
    }
  },
};

const auth = {
  scopes: ['manage:landing:page'] as string[],
  token: { sub: 'user-1', clientId: 'console-app' },
};

jest.unstable_mockModule('#src/env-set/index.js', () => ({
  EnvSet: {
    get values() {
      return {
        adminUrlSet: { endpoint: new URL('https://admin.example.com') },
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

// The slides builder loads an ES-only PowerPoint library that Jest cannot parse here. These tests do not
// build slides, so the builder is replaced.
jest.unstable_mockModule('./landing-page-slides.js', () => ({
  buildSlidesDeck: async () => Buffer.from(''),
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

const lead = (index: number): Row => ({
  id: `lead-${index}`,
  sessionId: `session-${index}`,
  lead: { firstName: `Visitor${index}`, lastName: 'Test', email: `v${index}@example.com` },
  emailStatus: 'sent',
  status: 'new',
  createdAt: new Date(2026, 9, index).toISOString(),
});

beforeEach(() => {
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
});

/* eslint-enable @silverhand/fp/no-mutation */

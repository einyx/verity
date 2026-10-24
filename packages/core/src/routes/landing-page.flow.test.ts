/* eslint-disable @silverhand/fp/no-mutation, @silverhand/fp/no-mutating-methods -- The in-memory tables are the test's fake database, so they are reassigned and appended to per test. */
import { defaultLandingPageContent, type LandingPageDocument } from '@logto/schemas';
import Koa from 'koa';
import request from 'supertest';

const { jest } = import.meta;

type Row = Record<string, unknown>;

type Query = { sql: string; values: unknown[] };

type FakePool = {
  maybeOne: (query: Query) => Promise<Row | undefined>;
  one: (query: Query) => Promise<Row>;
  any: (query: Query) => Promise<Row[]>;
  query: (query: Query) => Promise<void>;
  transaction: (callback: (pool: FakePool) => Promise<void>) => Promise<void>;
};

// An in-memory stand-in for the two landing page tables. It answers the queries the routes send by
// matching their SQL text, so the version numbering and publish/rollback rules run for real.
const state: { page?: Row; versions: Row[] } = { versions: [] };

// `sql.jsonb` sends documents as JSON text, which Postgres stores as jsonb; the fake reads it back.
const fromJsonb = (value: unknown): unknown =>
  typeof value === 'string' ? (JSON.parse(value) as unknown) : value;

const fakePool: FakePool = {
  maybeOne: async (query) => {
    if (query.sql.includes('from landing_page_versions') && query.sql.includes('where tenant_id')) {
      const version = query.values.find((value) => typeof value === 'number');
      return state.versions.find((row) => row.version === version);
    }
    return state.page;
  },
  one: async () => ({ latest: Math.max(0, ...state.versions.map((row) => Number(row.version))) }),
  any: async () =>
    [...state.versions].sort((left, right) => Number(right.version) - Number(left.version)),
  query: async (query) => {
    const { sql: text, values } = query;
    if (text.includes('insert into landing_page_versions')) {
      state.versions.push({
        version: values[2],
        document: fromJsonb(values[3]),
        publishedBy: values[4],
        createdAt: new Date(),
      });
      return;
    }
    if (text.includes('insert into landing_pages')) {
      state.page = {
        published: null,
        publishedVersion: null,
        ...state.page,
        draft: fromJsonb(values[2]),
      };
      return;
    }
    if (text.includes('update landing_pages') && text.includes('published_version')) {
      const published = fromJsonb(values[0]);
      const version = values[1];
      state.page = { ...state.page, published, publishedVersion: version };
    }
  },
  transaction: async (callback) => callback(fakePool),
};

const scopes = { current: ['manage:landing:page'] };
const token = { sub: 'user-1', clientId: 'console-app' };

jest.unstable_mockModule('#src/env-set/index.js', () => ({
  EnvSet: {
    values: {
      adminUrlSet: { endpoint: new URL('https://admin.example.com') },
      // The editor accepts a token only when it was issued for this instance's cloud API resource.
      cloudUrlSet: { endpoint: new URL('https://cloud.example.com') },
      isDevFeaturesEnabled: true,
      isProduction: false,
      isUnitTest: true,
    },
    sharedPool: Promise.resolve(fakePool),
  },
}));

jest.unstable_mockModule('#src/middleware/koa-auth/index.js', () => ({
  verifyBearerTokenFromRequest: async () => ({ ...token, scopes: scopes.current }),
}));

const { landingPageRoutes } = await import('./landing-page.js');

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
  app.use(landingPageRoutes({} as never).routes());
  return app.callback();
};

const authed = (method: 'get' | 'post' | 'put', path: string) =>
  request(createApp())[method](path).set('Authorization', 'Bearer test');

const getHeroHeadline = (document: LandingPageDocument) => {
  const hero = document.sections.find(({ type }) => type === 'hero');
  return hero?.type === 'hero' ? hero.headline : undefined;
};

beforeEach(() => {
  state.page = undefined;
  state.versions = [];
  scopes.current = ['manage:landing:page'];
  token.clientId = 'console-app';
});

describe('landing page publishing', () => {
  it('serves the shipped copy until something is saved', async () => {
    const response = await request(createApp()).get('/api/landing-page');
    expect(response.status).toBe(200);
    expect(response.body.published).toBeNull();
    expect(response.body.publishedVersion).toBeNull();
  });

  it('keeps the public read independent of an invalid unpublished draft', async () => {
    state.page = {
      draft: { hero: { headline: ['retired format'] } },
      published: defaultLandingPageContent,
      publishedVersion: 1,
    };

    const response = await request(createApp()).get('/api/landing-page');

    expect(response.status).toBe(200);
    expect(response.body.publishedVersion).toBe(1);
  });

  it('keeps the draft out of the public read until publish', async () => {
    await authed('put', '/api/landing-page/draft').send(defaultLandingPageContent);
    const before = await request(createApp()).get('/api/landing-page');
    expect(before.body.published).toBeNull();

    await authed('post', '/api/landing-page/publish');
    const after = await request(createApp()).get('/api/landing-page');
    expect(after.body.publishedVersion).toBe(1);
    const published = after.body.published as unknown as LandingPageDocument;
    expect(getHeroHeadline(published)).toEqual(getHeroHeadline(defaultLandingPageContent));
  });

  it('numbers each publish one higher than the last', async () => {
    await authed('put', '/api/landing-page/draft').send(defaultLandingPageContent);
    await authed('post', '/api/landing-page/publish');
    await authed('post', '/api/landing-page/publish');

    const versions = await authed('get', '/api/landing-page/versions');
    expect(versions.body).toMatchObject([
      { version: 2, publishedBy: 'user-1' },
      { version: 1, publishedBy: 'user-1' },
    ]);
  });

  it('rolls back the published copy and leaves the draft alone', async () => {
    const original = defaultLandingPageContent;
    await authed('put', '/api/landing-page/draft').send(original);
    await authed('post', '/api/landing-page/publish');

    const changed = {
      ...original,
      sections: original.sections.map((section) =>
        section.type === 'hero'
          ? { ...section, headline: ['Enterprise', 'intelligence', 'changed.'] }
          : section
      ),
    };
    await authed('put', '/api/landing-page/draft').send(changed);
    await authed('post', '/api/landing-page/publish');

    const rolledBack = await authed('post', '/api/landing-page/rollback').send({ version: 1 });
    expect(rolledBack.status).toBe(200);
    expect(rolledBack.body.publishedVersion).toBe(1);
    const published = rolledBack.body.published as unknown as LandingPageDocument;
    const draft = rolledBack.body.draft as unknown as LandingPageDocument;
    expect(getHeroHeadline(published)).toEqual(getHeroHeadline(original));
    expect(getHeroHeadline(draft)).toEqual(getHeroHeadline(changed));
  });

  it('refuses to roll back to a version that does not exist', async () => {
    await authed('put', '/api/landing-page/draft').send(defaultLandingPageContent);
    await authed('post', '/api/landing-page/publish');

    const response = await authed('post', '/api/landing-page/rollback').send({ version: 9 });
    expect(response.status).toBe(404);
  });

  it('refuses a token without the landing page scope', async () => {
    scopes.current = ['manage:tenant:self'];
    const response = await authed('post', '/api/landing-page/publish');
    expect(response.status).toBe(403);
  });

  it('refuses a machine token, which has no user to attribute the publish to', async () => {
    token.clientId = 'user-1';
    const response = await authed('post', '/api/landing-page/publish');
    expect(response.status).toBe(403);
  });
});

/* eslint-enable @silverhand/fp/no-mutation, @silverhand/fp/no-mutating-methods */

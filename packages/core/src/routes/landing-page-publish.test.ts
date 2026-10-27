import { CloudScope, defaultLandingPageContent, PredefinedScope } from '@logto/schemas';
import { ConsoleLog } from '@logto/shared';
import Koa from 'koa';
import request from 'supertest';

import { type EnvSet } from '#src/env-set/index.js';

const { jest } = import.meta;

// The draft → publish handoff. Publish must refuse to copy a draft that changed since the editor
// last saved, so one editor cannot silently publish another editor's newer content.

const updatedAt = new Date('2026-10-25T10:00:00.000Z');
const staleUpdatedAt = '2026-10-25T09:00:00.000Z';

const pageRow = (publishedVersion: number): PageRowFixture => ({
  draft: defaultLandingPageContent,
  published: defaultLandingPageContent,
  publishedVersion,
  updatedAt: updatedAt.getTime(),
});

// Shaped like the row the driver returns: the timestamp comes back as epoch milliseconds.
type PageRowFixture = {
  draft: unknown;
  published: unknown;
  publishedVersion: number;
  updatedAt: number;
};
const maybeOne = jest.fn<Promise<PageRowFixture>, Parameters<() => Promise<PageRowFixture>>>();
const query = jest.fn();
const one = jest.fn<Promise<{ latest: number }>, Parameters<() => Promise<{ latest: number }>>>();
const connectionQuery = jest.fn();
const connection = { one, query: connectionQuery };
const transaction = jest.fn(
  async (
    run: (connection: { one: typeof one; query: typeof connectionQuery }) => Promise<unknown>
  ) => run(connection)
);

const fakePool = { maybeOne, query, transaction };

jest.unstable_mockModule('#src/env-set/index.js', () => ({
  EnvSet: {
    values: {
      isCloud: true,
      isDevFeaturesEnabled: true,
      cloudUrlSet: { endpoint: new URL('https://cloud.example.com') },
    },
    sharedPool: Promise.resolve(fakePool),
  },
}));

jest.unstable_mockModule('#src/middleware/koa-auth/index.js', () => ({
  verifyBearerTokenFromRequest: async () => ({
    sub: 'user-1',
    clientId: 'client-1',
    scopes: [PredefinedScope.All, CloudScope.ManageLandingPage],
  }),
}));

const { landingPageRoutes } = await import('./landing-page.js');

const createApp = () => {
  const app = new Koa();
  // Koa Guard reads the request console from the context, which the real app installs globally.
  app.use(async (ctx, next) => {
    ctx.console = new ConsoleLog();
    return next();
  });
  app.use(async (ctx, next) => {
    try {
      await next();
    } catch (error: unknown) {
      const status = (error as { status?: number }).status ?? 500;
      ctx.status = status;
      ctx.body = { code: (error as { code?: string }).code };
    }
  });
  app.use(landingPageRoutes({} as unknown as EnvSet).routes());
  return app.callback();
};

const authedRequest = () => ({
  put: (path: string) => request(createApp()).put(path).set('Authorization', 'Bearer test-token'),
  post: (path: string) => request(createApp()).post(path).set('Authorization', 'Bearer test-token'),
});

beforeEach(() => {
  // Reset rather than clear, so queued one-off values from an earlier test cannot leak into the next.
  maybeOne.mockReset();
  query.mockReset();
  one.mockReset();
  connectionQuery.mockReset();
  transaction.mockClear();
  maybeOne.mockResolvedValue(pageRow(1));
  one.mockResolvedValue({ latest: 1 });
});

describe('landing page publish concurrency', () => {
  it('returns the draft updated time when a draft is saved', async () => {
    const response = await authedRequest()
      .put('/api/landing-page/draft')
      .send(defaultLandingPageContent)
      .expect(200);

    expect(response.body.updatedAt).toBe(updatedAt.toISOString());
  });

  it('refuses to publish when the draft changed after the editor saved it', async () => {
    const response = await authedRequest()
      .post('/api/landing-page/publish')
      .send({ expectedUpdatedAt: staleUpdatedAt })
      .expect(409);

    expect(response.body.code).toBe('entity.edit_conflict');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('publishes when the editor saw the current draft', async () => {
    // The route reads the page before the transaction and again after it.
    maybeOne.mockResolvedValueOnce(pageRow(1)).mockResolvedValueOnce(pageRow(2));
    const response = await authedRequest()
      .post('/api/landing-page/publish')
      .send({ expectedUpdatedAt: updatedAt.toISOString() })
      .expect(200);

    expect(response.body.publishedVersion).toBe(2);
    expect(transaction).toHaveBeenCalled();
  });

  it('publishes without a precondition, so older clients keep working', async () => {
    maybeOne.mockResolvedValueOnce(pageRow(1)).mockResolvedValueOnce(pageRow(2));
    const response = await authedRequest().post('/api/landing-page/publish').expect(200);

    expect(response.body.publishedVersion).toBe(2);
  });
});

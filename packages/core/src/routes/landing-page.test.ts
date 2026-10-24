import { adminTenantId, defaultLandingPageContent } from '@logto/schemas';
import Koa from 'koa';
import request from 'supertest';

import { type EnvSet } from '#src/env-set/index.js';

import { landingPageRoutes } from './landing-page.js';

// Only the auth path is exercised here: a request without a bearer token must be refused before any
// database access, so the env set needs no pool.
const createApp = () => {
  const envSet = {
    tenantId: adminTenantId,
    oidc: { publicJwks: [], issuer: 'https://admin.example.com/oidc' },
    pool: {},
  } as unknown as EnvSet;

  const app = new Koa();
  app.use(async (ctx, next) => {
    try {
      await next();
    } catch (error: unknown) {
      const status = (error as { status?: number }).status ?? 500;
      ctx.status = status;
      ctx.body = { message: (error as Error).message };
    }
  });
  app.use(landingPageRoutes(envSet).routes());
  return app.callback();
};

describe('landing page routes', () => {
  it('accepts optional element overrides at the validation boundary but still requires authentication', async () => {
    const response = await request(createApp())
      .put('/api/landing-page/draft')
      .send({
        ...defaultLandingPageContent,
        elements: { 'header-link-1': { text: 'Platform', href: '#platform' } },
      });
    expect(response.status).toBe(401);
  });

  it('rejects unsafe element image sources before authentication', async () => {
    const response = await request(createApp())
      .put('/api/landing-page/draft')
      .send({
        ...defaultLandingPageContent,
        // eslint-disable-next-line no-script-url -- Negative fixture verifies that executable image sources fail request validation.
        elements: { 'header-image-1': { src: 'javascript:alert(1)' } },
      });
    expect(response.status).toBe(400);
  });
  it('refuses reading the editor view without a bearer token', async () => {
    const response = await request(createApp()).get('/api/landing-page/editor');
    expect(response.status).toBe(401);
  });

  it('refuses saving a draft without a bearer token', async () => {
    const response = await request(createApp())
      .put('/api/landing-page/draft')
      .send(defaultLandingPageContent);
    expect(response.status).toBe(401);
  });

  it('rejects a malformed draft before checking the token', async () => {
    const response = await request(createApp())
      .put('/api/landing-page/draft')
      .send({ sections: [{ type: 'unknown-section' }] });
    expect(response.status).toBe(400);
  });

  it('rejects a draft in the retired fixed-field document shape', async () => {
    const response = await request(createApp())
      .put('/api/landing-page/draft')
      .send({ demoChat: { enabled: true }, hero: { headline: ['Old format'] } });
    expect(response.status).toBe(400);
  });

  it('refuses publishing without a bearer token', async () => {
    const response = await request(createApp()).post('/api/landing-page/publish');
    expect(response.status).toBe(401);
  });

  it('refuses rolling back without a bearer token', async () => {
    const response = await request(createApp())
      .post('/api/landing-page/rollback')
      .send({ version: 1 });
    expect(response.status).toBe(401);
  });

  it('refuses listing versions without a bearer token', async () => {
    const response = await request(createApp()).get('/api/landing-page/versions');
    expect(response.status).toBe(401);
  });
});

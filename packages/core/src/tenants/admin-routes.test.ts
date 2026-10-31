import { type IncomingMessage, type ServerResponse } from 'node:http';
import { text } from 'node:stream/consumers';

import { adminTenantId } from '@logto/schemas';
import { createMockUtils } from '@logto/shared/esm';
import Koa, { type Middleware } from 'koa';
import request from 'supertest';

import { type EnvSet } from '#src/env-set/index.js';

const { jest } = import.meta;
const { mockEsm } = createMockUtils(jest);
const isCloudPluginInstalled = jest.fn(() => false);
const passThrough: Middleware = async (_ctx, next) => next();
const echoRequest = async (incoming: IncomingMessage, response: ServerResponse) => {
  response.writeHead(200, { 'content-type': 'text/plain' });
  response.end(await text(incoming));
};
const usageFixture: Middleware = async (ctx, next) => {
  if (ctx.path === '/api/tenants/tenant-1/subscription/periodic-usage') {
    ctx.body = { mauLimit: 2 };
    return;
  }
  return next();
};

mockEsm('#src/env-set/index.js', () => ({
  EnvSet: {
    values: {
      isCloud: false,
      isProduction: true,
      adminUrlSet: { endpoint: new URL('https://admin.example.com') },
    },
  },
}));
mockEsm('@silverhand/slonik', () => ({ createPool: async () => ({}) }));
// The private package is the external boundary. Its fixture echoes the raw request stream.
mockEsm('#src/cloud-plugin/index.js', () => ({
  isCloudPluginInstalled,
  loadCloudPlugin: async () => ({
    createPgBillingStore: () => ({}),
    migrateBillingSchema: async () => ({}),
    createBillingComposer: () => ({}),
    createBillingHandler: () => echoRequest,
  }),
}));
mockEsm('#src/routes/cloud-dev.js', () => ({ localCloudRoutes: () => passThrough }));
mockEsm('#src/routes/cloud-tenants.js', () => ({
  cloudTenantRoutes: () => ({ routes: () => passThrough }),
}));
mockEsm('#src/routes/landing-page.js', () => ({
  landingPageRoutes: () => ({ routes: () => passThrough }),
}));
mockEsm('#src/routes/landing-page-leads.js', () => ({
  landingPageLeadRoutes: () => ({ routes: () => passThrough }),
}));
mockEsm('#src/routes/landing-page-chat-counters.js', () => ({ createSharedHitStore: () => ({}) }));
mockEsm('#src/routes/landing-page-chat.js', () => ({
  createChatState: () => ({}),
  createProductionChatDeps: () => ({}),
  landingPageChatRoutes: () => ({ routes: () => passThrough }),
}));
mockEsm('#src/routes/periodic-usage.js', () => ({
  periodicUsageRoute: () => usageFixture,
}));

const { mountAdminRoutes } = await import('./admin-routes.js');
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Environment access is mocked; the usage fixture does not read the instance.
const envSet = {} as EnvSet;

beforeEach(() => {
  isCloudPluginInstalled.mockReturnValue(false);
  jest.replaceProperty(process, 'env', {
    ...process.env,
    BILLING_DATABASE_URL: 'postgres://localhost/billing',
    STRIPE_SECRET_KEY: 'sk_test_fixture',
    STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
    STRIPE_PRO_PRICE_ID: 'price_fixture',
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

const appFor = (tenantId = adminTenantId) => {
  const app = new Koa();
  mountAdminRoutes(app, tenantId, envSet);
  // A later API body parser would destroy the original formatting if the plugin fell through.
  app.use(async (ctx, next) => {
    if (ctx.method === 'POST') {
      ctx.body = JSON.stringify(JSON.parse(await text(ctx.req)));
      return;
    }
    return next();
  });
  return app;
};

it('does not mount private billing or usage middleware without the package', async () => {
  const app = appFor();
  const billing = await request(app.callback()).get('/api/skus');
  const usage = await request(app.callback()).get(
    '/api/tenants/tenant-1/subscription/periodic-usage'
  );
  expect(billing.status).toBe(404);
  expect(usage.status).toBe(404);
});

it('mounts enabled private usage and preserves webhook bytes before API body parsing', async () => {
  isCloudPluginInstalled.mockReturnValue(true);
  const app = appFor();
  const payload = '{ "event": "invoice.paid",\n  "amount": 12 }\n';
  const webhook = await request(app.callback())
    .post('/api/webhooks/stripe')
    .set('content-type', 'application/json')
    .send(payload);
  expect(webhook.status).toBe(200);
  expect(webhook.text).toBe(payload);
  const usage = await request(app.callback()).get(
    '/api/tenants/tenant-1/subscription/periodic-usage'
  );
  expect(usage.body).toEqual({ mauLimit: 2 });
});

it('does not mount private middleware on a non-admin tenant', async () => {
  isCloudPluginInstalled.mockReturnValue(true);
  const response = await request(appFor('another-tenant').callback()).get(
    '/api/tenants/tenant-1/subscription/periodic-usage'
  );
  expect(response.status).toBe(404);
});

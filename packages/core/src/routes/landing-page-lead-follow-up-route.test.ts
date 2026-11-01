import Koa from 'koa';
import Router from 'koa-router';
import request from 'supertest';

const { jest } = import.meta;
const values = { isDevFeaturesEnabled: true };
const lead = { email: 'alex@example.com', consent: true, contactMethod: 'email' };
const maybeOne = jest.fn(async (_query: unknown) => ({
  lead,
  companyProfile: { syntheticContact: false },
}));
const authenticate = jest.fn(async () => 'admin-user');
const sendLeadFollowUp = jest.fn(async () => ({
  ok: true,
  status: 'accepted',
  requestId: 'request-1',
}));
jest.unstable_mockModule('#src/env-set/index.js', () => ({ EnvSet: { values } }));
jest.unstable_mockModule('#src/libraries/acs-mail.js', () => ({
  readAcsMailConfig: () => ({ sender: 'team@example.com' }),
}));
jest.unstable_mockModule('./landing-page-lead-follow-up.js', () => ({ sendLeadFollowUp }));
jest.unstable_mockModule('./landing-page-lead-follow-up-store.js', () => ({
  createFollowUpStore: () => ({}),
}));
const { mountLeadFollowUpRoute } = await import('./landing-page-lead-follow-up-route.js');
const pool = { maybeOne };
const createApp = () => {
  const app = new Koa();
  const router = new Router();
  mountLeadFollowUpRoute(router, authenticate, async () => pool as never);
  app.use(router.routes());
  return app.callback();
};
beforeEach(() => {
  jest.clearAllMocks();
});
afterEach(() => {
  jest.restoreAllMocks();
});

it('uses the authenticated caller and saved lead, never a client-chosen recipient', async () => {
  const body = {
    subject: 'Review',
    text: 'Reviewed message',
    confirmed: true,
    idempotencyKey: 'review-key-1234567890',
  };
  const response = await request(createApp())
    .post('/api/landing-leads/session-1/follow-up')
    .send(body);
  expect(response.status).toBe(202);
  expect(sendLeadFollowUp).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: 'admin-user',
      sessionId: 'session-1',
      lead,
      body,
      isSynthetic: false,
    })
  );
  expect(maybeOne.mock.calls[0]?.[0]).toMatchObject({
    values: ['admin', 'session-1'],
  });
});

it('does not expose sending when dev features are disabled', async () => {
  jest.replaceProperty(values, 'isDevFeaturesEnabled', false);
  const response = await request(createApp())
    .post('/api/landing-leads/session-1/follow-up')
    .send({});
  expect(response.status).toBe(404);
  expect(sendLeadFollowUp).not.toHaveBeenCalled();
});

it('does not send when the existing administrator authorization rejects the caller', async () => {
  const denied = new Error('Forbidden');
  // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- Koa needs a writable HTTP status on this test's denied-authorization error.
  Object.defineProperty(denied, 'status', { value: 403, writable: true });
  authenticate.mockRejectedValueOnce(denied);
  const response = await request(createApp())
    .post('/api/landing-leads/session-1/follow-up')
    .send({});
  expect(response.status).toBe(403);
  expect(sendLeadFollowUp).not.toHaveBeenCalled();
});

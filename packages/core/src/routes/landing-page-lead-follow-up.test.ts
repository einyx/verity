import { type AcsMail, type AcsMailConfig } from '#src/libraries/acs-mail.js';

import { type PendingAction } from './ai-chat-actions.js';
import { sendLeadFollowUp, type FollowUpStore } from './landing-page-lead-follow-up.js';

const { jest } = import.meta;
const now = new Date('2026-11-01T12:00:00Z');
const config: AcsMailConfig = {
  endpoint: new URL('https://mail.example.com'),
  accessKey: new Uint8Array([1]),
  sender: 'team@example.com',
};
const body = {
  subject: 'Your MeshX demo',
  text: 'Hi Alex,\n\nThanks for your interest.\n\nThe MeshX team',
  confirmed: true,
  idempotencyKey: 'request-key-1234567890',
};
const lead = { email: 'alex@example.com', consent: true, contactMethod: 'email' };
const acceptMail = async (_mail: AcsMail) => {
  await Promise.resolve();
};

const memoryStore = () => {
  const rows = new Map<string, PendingAction>();
  const store: FollowUpStore = {
    reserve: async (action) => {
      if (!rows.has(action.id)) {
        rows.set(action.id, action);
      }
    },
    findById: async (id, tenantId) => {
      const action = rows.get(id);
      return action?.tenantId === tenantId ? action : undefined;
    },
    claim: async (id, tenantId, userId, time) => {
      const action = rows.get(id);
      if (
        !action ||
        action.tenantId !== tenantId ||
        action.userId !== userId ||
        action.state !== 'pending' ||
        action.expiresAt <= time
      ) {
        return;
      }
      const claimed: PendingAction = { ...action, state: 'confirmed' };
      rows.set(id, claimed);
      return claimed;
    },
    setOutcome: async (id, state, result) => {
      const action = rows.get(id);
      if (action) {
        rows.set(id, { ...action, state, result });
      }
    },
  };
  return { store, rows };
};

const options = (store: FollowUpStore) => ({
  store,
  userId: 'admin-user',
  sessionId: 'session-1',
  lead,
  isSynthetic: false,
  body,
  config,
  now,
  allowSend: async () => true,
});

it('sends only the reviewed body to the saved consenting recipient and records provider acceptance', async () => {
  const { store, rows } = memoryStore();
  const deliver = jest.fn(acceptMail);
  const result = await sendLeadFollowUp({ ...options(store), deliver });
  expect(result).toMatchObject({ ok: true, status: 'accepted' });
  expect(deliver).toHaveBeenCalledTimes(1);
  expect(deliver.mock.calls[0]?.[0]).toMatchObject({
    to: 'alex@example.com',
    subject: body.subject,
    text: body.text,
  });
  expect([...rows.values()][0]).toMatchObject({
    state: 'executed',
    userId: 'admin-user',
    result: { status: 'accepted' },
  });
});

it('replays an accepted request without another send and refuses the same key with a changed body', async () => {
  const { store } = memoryStore();
  const deliver = jest.fn(acceptMail);
  const first = await sendLeadFollowUp({ ...options(store), deliver });
  expect(await sendLeadFollowUp({ ...options(store), deliver })).toEqual(first);
  expect(
    await sendLeadFollowUp({
      ...options(store),
      body: { ...body, text: 'Changed message' },
      deliver,
    })
  ).toMatchObject({ ok: false, code: 'conflict' });
  expect(deliver).toHaveBeenCalledTimes(1);
});

it('atomically claims concurrent requests so only one reaches the provider', async () => {
  const { store } = memoryStore();
  const deliver = jest.fn(acceptMail);
  await Promise.all([
    sendLeadFollowUp({ ...options(store), deliver }),
    sendLeadFollowUp({ ...options(store), deliver }),
  ]);
  expect(deliver).toHaveBeenCalledTimes(1);
});

it.each([
  { lead: { ...lead, consent: false } },
  { lead: { ...lead, contactMethod: 'whatsapp' } },
  { lead: { ...lead, email: 'invalid' } },
  { isSynthetic: true },
  { profile: { researchStatus: 'fixture' } },
  { profile: { researchStatus: 'synthetic' } },
  { profile: { researchStatus: 'demo-data' } },
  { tags: ['test-data'] },
  { tags: ['DEMO DATA'] },
  { lead: { ...lead, email: 'alex@team.example.invalid' } },
])('refuses contact when stored permission or identity is unsuitable: %j', async (overrides) => {
  const { store, rows } = memoryStore();
  const deliver = jest.fn(acceptMail);
  expect(await sendLeadFollowUp({ ...options(store), ...overrides, deliver })).toMatchObject({
    ok: false,
    code: 'contact_not_allowed',
  });
  expect(deliver).not.toHaveBeenCalled();
  expect(rows.size).toBe(0);
});

it.each([
  { ...body, confirmed: false },
  { ...body, recipient: 'other@example.com' },
  { ...body, subject: 'Subject\r\nBcc: other@example.com' },
  { ...body, text: 'Best regards, [Your Name] [Your Company]' },
])('rejects unreviewed, injected or unfinished messages: %j', async (input) => {
  const { store } = memoryStore();
  const deliver = jest.fn(acceptMail);
  expect(await sendLeadFollowUp({ ...options(store), body: input, deliver })).toMatchObject({
    ok: false,
    code: 'invalid_input',
  });
  expect(deliver).not.toHaveBeenCalled();
});

it('fails closed without sender configuration or rate-limit permission', async () => {
  const { store } = memoryStore();
  const deliver = jest.fn(acceptMail);
  expect(await sendLeadFollowUp({ ...options(store), config: undefined, deliver })).toMatchObject({
    ok: false,
    code: 'unconfigured',
  });
  expect(
    await sendLeadFollowUp({ ...options(store), allowSend: async () => false, deliver })
  ).toMatchObject({ ok: false, code: 'rate_limited' });
  expect(deliver).not.toHaveBeenCalled();
});

it('records an ambiguous transport failure and never retries it with the same key', async () => {
  const { store } = memoryStore();
  const deliver = jest.fn(async () => {
    throw new Error('Timeout after submission');
  });
  expect(await sendLeadFollowUp({ ...options(store), deliver })).toMatchObject({
    ok: false,
    code: 'unknown',
  });
  expect(await sendLeadFollowUp({ ...options(store), deliver })).toMatchObject({
    ok: false,
    code: 'unknown',
  });
  expect(deliver).toHaveBeenCalledTimes(1);
});

it('escapes HTML-like message text and preserves paragraph and line boundaries', async () => {
  const { store } = memoryStore();
  const deliver = jest.fn(acceptMail);
  await sendLeadFollowUp({
    ...options(store),
    body: { ...body, text: 'Hi Alex,\n\n<script>alert(1)</script>\nThe team' },
    deliver,
  });
  const html = deliver.mock.calls[0]?.[0].html;
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;<br>The team');
  expect(html).not.toContain('<script>');
  expect(html?.match(/<p /g)).toHaveLength(2);
});

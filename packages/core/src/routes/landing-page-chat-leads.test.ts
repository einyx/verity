/* eslint-disable @silverhand/fp/no-mutating-methods -- The tests record each lead the route sends. */
import { createChatState, handleChatTurn, type LandingPageChatDeps } from './landing-page-chat.js';

const sessionId = 'session-leads-0001';
const ip = '203.0.113.30';
const enabledDocument = { demoChat: { enabled: true } };

const lead = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  company: 'Analytical Engines',
  consent: true,
};

/** One scripted model reply per turn. `sent` collects each lead the route delivers. */
const depsWith = (replies: Array<{ content?: string; lead?: unknown }>, sent: unknown[]) => {
  const queue = [...replies];
  const deps: LandingPageChatDeps = {
    readPublished: async () => enabledDocument,
    callModel: async () => queue.shift() ?? { content: 'ok' },
    sendLead: async (value) => {
      sent.push(value);
    },
    recordTurn: async () => {
      // Saving is not part of these tests: they check only what is delivered.
    },
  };

  return deps;
};

const input = (message: string) => ({ sessionId, message, ip });

describe('landing page chat leads', () => {
  it('delivers a complete lead once the visitor has consented', async () => {
    const sent: unknown[] = [];
    const deps = depsWith(
      [
        { content: 'May we contact you about your demo?\n[[options: Yes | No]]' },
        { content: 'Thanks, sending now.', lead },
      ],
      sent
    );
    const state = createChatState();

    await handleChatTurn(input('Ada Lovelace, Analytical Engines'), deps, state);
    const result = await handleChatTurn(input('yes, email me'), deps, state);

    expect(sent).toHaveLength(1);
    expect(result.status).toBe(200);
  });

  it('does not deliver a lead without consent', async () => {
    const sent: unknown[] = [];
    const deps = depsWith(
      [{ content: 'Shall I send it?', lead: { ...lead, consent: false } }],
      sent
    );

    await handleChatTurn(input('ada@example.com'), deps, createChatState());

    expect(sent).toHaveLength(0);
  });

  it('does not deliver a lead without a company', async () => {
    const sent: unknown[] = [];
    const { company: _company, ...withoutCompany } = lead;
    const deps = depsWith([{ content: 'Which company are you with?', lead: withoutCompany }], sent);

    const result = await handleChatTurn(input('ada@example.com, yes'), deps, createChatState());

    expect(sent).toHaveLength(0);
    expect(result.status).toBe(200);
  });

  it('does not deliver a lead with an invalid email', async () => {
    const sent: unknown[] = [];
    const deps = depsWith(
      [{ content: 'Could you check the email?', lead: { ...lead, email: 'not-an-email' } }],
      sent
    );

    await handleChatTurn(input('my email is not-an-email'), deps, createChatState());

    expect(sent).toHaveLength(0);
  });
});

/* eslint-enable @silverhand/fp/no-mutating-methods */

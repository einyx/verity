/* eslint-disable @silverhand/fp/no-mutating-methods, @silverhand/fp/no-mutation -- The tests record each turn the route saves, and switch the scripted model reply between turns. */
import { type RecordedChatTurn } from './landing-page-chat-store.js';
import { createChatState, handleChatTurn, type LandingPageChatDeps } from './landing-page-chat.js';

const sessionId = 'session-abcdefgh-5678';
const ip = '203.0.113.9';

const validLead = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  company: 'Analytical Engines',
  consent: true,
};

const enabledDocument = { demoChat: { enabled: true } };

/** Fake dependencies. `recorded` collects every turn the route asks to save. */
const fakeDeps = (options: {
  reply?: { content?: string; lead?: unknown };
  recordFails?: boolean;
}) => {
  const recorded: RecordedChatTurn[] = [];
  const sent: unknown[] = [];

  const deps: LandingPageChatDeps = {
    readPublished: async () => enabledDocument,
    callModel: async () => options.reply ?? { content: 'meshX connects your data to your AI.' },
    sendLead: async (lead) => {
      sent.push(lead);
    },
    recordTurn: async (turn) => {
      if (options.recordFails) {
        throw new Error('database down');
      }

      recorded.push(turn);
    },
  };

  return { deps, recorded };
};

const input = (message: string) => ({ sessionId, message, ip });

describe('landing page chat recording', () => {
  it('saves a text turn with only the visitor and assistant messages', async () => {
    const { deps, recorded } = fakeDeps({});

    await handleChatTurn(input('What is meshX?'), deps, createChatState());

    expect(recorded).toEqual([
      {
        sessionId,
        messages: [
          { role: 'user', content: 'What is meshX?' },
          { role: 'assistant', content: 'meshX connects your data to your AI.' },
        ],
        submitted: false,
      },
    ]);
  });

  it('saves a submitted lead with its fields and the closing reply', async () => {
    const { deps, recorded } = fakeDeps({
      reply: { content: 'May we contact you about your demo?\n[[options: Yes | No]]' },
    });
    const state = createChatState();

    await handleChatTurn(input('Ada, ada@example.com, Analytical Engines'), deps, state);
    deps.callModel = async () => ({ lead: validLead });
    await handleChatTurn(input('yes'), deps, state);

    expect(recorded).toHaveLength(2);
    expect(recorded[1]).toMatchObject({ sessionId, lead: validLead, submitted: true });
    expect(recorded[1]?.messages.at(-1)?.role).toBe('assistant');
  });

  it('still answers the visitor when the save fails', async () => {
    const { deps } = fakeDeps({ recordFails: true });

    const result = await handleChatTurn(input('What is meshX?'), deps, createChatState());

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ reply: 'meshX connects your data to your AI.' });
  });
});

/* eslint-enable @silverhand/fp/no-mutating-methods, @silverhand/fp/no-mutation */

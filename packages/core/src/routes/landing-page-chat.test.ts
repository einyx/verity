/* eslint-disable @silverhand/fp/no-let, @silverhand/fp/no-mutation, @silverhand/fp/no-mutating-methods, no-await-in-loop -- The tests record fake model and lead calls, and each turn must finish before the next one starts. */
import { createChatState, handleChatTurn, type LandingPageChatDeps } from './landing-page-chat.js';

const sessionId = 'session-abcdefgh-1234';
const ip = '203.0.113.7';

const validLead = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  company: 'Analytical Engines',
  consent: true,
};

const enabledDocument = { demoChat: { enabled: true } };

/** Fake dependencies that record what the route sent. */
const fakeDeps = (options: {
  published?: unknown;
  reply?: { content?: string; lead?: unknown } | 'throw';
  sendLeadFails?: boolean;
}) => {
  const modelCalls: Array<Array<{ role: string; content: string }>> = [];
  const leads: unknown[] = [];

  const deps: LandingPageChatDeps = {
    readPublished: async () => options.published ?? enabledDocument,
    callModel: async (messages) => {
      modelCalls.push(messages);

      if (options.reply === 'throw') {
        throw new Error('model down');
      }

      return options.reply ?? { content: 'meshX connects your data to your AI.' };
    },
    sendLead: async (lead) => {
      if (options.sendLeadFails) {
        throw new Error('ACS down');
      }

      leads.push(lead);
    },
  };

  return { deps, modelCalls, leads };
};

const turn = (message: string, id = sessionId, address = ip) => ({
  sessionId: id,
  message,
  ip: address,
});

describe('handleChatTurn', () => {
  it('returns not found and does not call the model while the switch is off', async () => {
    const { deps, modelCalls } = fakeDeps({ published: { demoChat: { enabled: false } } });

    const result = await handleChatTurn(turn('What is meshX?'), deps, createChatState());

    expect(result.status).toBe(404);
    expect(modelCalls).toHaveLength(0);
  });

  it('returns not found when the published document has no switch at all', async () => {
    const { deps, modelCalls } = fakeDeps({ published: { hero: {} } });

    const result = await handleChatTurn(turn('What is meshX?'), deps, createChatState());

    expect(result.status).toBe(404);
    expect(modelCalls).toHaveLength(0);
  });

  it('returns the model reply for a valid message', async () => {
    const { deps, modelCalls } = fakeDeps({});

    const result = await handleChatTurn(turn('What is meshX?'), deps, createChatState());

    expect(result).toEqual({
      status: 200,
      body: { reply: 'meshX connects your data to your AI.', submitted: false },
    });
    expect(modelCalls[0]).toEqual([{ role: 'user', content: 'What is meshX?' }]);
  });

  it('rejects an empty message without calling the model', async () => {
    const { deps, modelCalls } = fakeDeps({});

    const result = await handleChatTurn(turn('   '), deps, createChatState());

    expect(result.status).toBe(400);
    expect(modelCalls).toHaveLength(0);
  });

  it('rejects a malformed session id', async () => {
    const { deps } = fakeDeps({});

    const result = await handleChatTurn(turn('hi', 'short'), deps, createChatState());

    expect(result.status).toBe(400);
  });

  it('sends the server transcript to the model, not a client-supplied one', async () => {
    const { deps, modelCalls } = fakeDeps({});
    const state = createChatState();

    await handleChatTurn(turn('First question'), deps, state);
    await handleChatTurn(turn('Second question'), deps, state);

    expect(modelCalls[1]).toEqual([
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'meshX connects your data to your AI.' },
      { role: 'user', content: 'Second question' },
    ]);
  });

  it('stops a conversation at the turn cap without calling the model again', async () => {
    const { deps, modelCalls } = fakeDeps({});
    const state = createChatState();

    for (let index = 0; index < 8; index += 1) {
      await handleChatTurn(turn(`question ${index}`), deps, state);
    }

    const result = await handleChatTurn(turn('one more'), deps, state);

    expect(result.status).toBe(429);
    expect(result.body.code).toBe('landing_page.chat_turn_limit');
    expect(modelCalls).toHaveLength(8);
  });

  it('delivers a valid lead once and then stops talking to the model', async () => {
    const { deps, modelCalls, leads } = fakeDeps({
      reply: { lead: validLead },
    });
    const state = createChatState();

    const first = await handleChatTurn(turn('Please contact me'), deps, state);
    const second = await handleChatTurn(turn('Anything else?'), deps, state);

    expect(first.body).toEqual({
      reply: 'Thanks. Your request is in, and the team will be in touch.',
      submitted: true,
    });
    expect(second.body.submitted).toBe(true);
    expect(leads).toEqual([validLead]);
    expect(modelCalls).toHaveLength(1);
  });

  it('does not deliver a lead that fails the schema', async () => {
    const { deps, leads } = fakeDeps({
      reply: { content: 'Could you confirm your email?', lead: { ...validLead, consent: false } },
    });

    const result = await handleChatTurn(turn('Here is my info'), deps, createChatState());

    expect(leads).toHaveLength(0);
    expect(result.body).toEqual({ reply: 'Could you confirm your email?', submitted: false });
  });

  it('tells the visitor when delivery fails and keeps the session open', async () => {
    const { deps } = fakeDeps({ reply: { lead: validLead }, sendLeadFails: true });
    const state = createChatState();

    const result = await handleChatTurn(turn('Please contact me'), deps, state);

    expect(result.status).toBe(503);
    expect(result.body.code).toBe('landing_page.chat_delivery_failed');
    expect(state.sessions.get(sessionId)?.submitted).toBe(false);
  });

  it('returns a clean error when the model call fails', async () => {
    const { deps } = fakeDeps({ reply: 'throw' });

    const result = await handleChatTurn(turn('What is meshX?'), deps, createChatState());

    expect(result.status).toBe(502);
    expect(result.body.code).toBe('landing_page.chat_unavailable');
  });

  it('caps new conversations per day across the instance', async () => {
    const { deps } = fakeDeps({});
    const state = createChatState();

    // The daily cap is 100 sessions; the 101st new session is refused.
    for (let index = 0; index < 100; index += 1) {
      const id = `session-${String(index).padStart(12, '0')}`;
      await handleChatTurn(turn('hi', id, `198.51.100.${index % 250}`), deps, state);
    }

    const result = await handleChatTurn(
      turn('hi', 'session-overflow-0001', '198.51.100.251'),
      deps,
      state
    );

    expect(result.status).toBe(429);
    expect(result.body.code).toBe('landing_page.chat_daily_limit');
  });

  it('rate limits one IP after its burst allowance', async () => {
    const { deps } = fakeDeps({});
    const state = createChatState();

    for (let index = 0; index < 15; index += 1) {
      await handleChatTurn(turn('hi', sessionId, '192.0.2.1'), deps, state);
    }

    const result = await handleChatTurn(turn('hi', sessionId, '192.0.2.1'), deps, state);

    expect(result.status).toBe(429);
    expect(result.body.code).toBe('landing_page.chat_rate_limited');
  });
});

/* eslint-enable @silverhand/fp/no-let, @silverhand/fp/no-mutation, @silverhand/fp/no-mutating-methods, no-await-in-loop */

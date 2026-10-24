/* eslint-disable @silverhand/fp/no-let, @silverhand/fp/no-mutation, @silverhand/fp/no-mutating-methods, no-await-in-loop -- The tests record fake model and lead calls, and each turn must finish before the next one starts. */
import { demoChatLimits } from './landing-page-chat-guard.js';
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
  recordFails?: boolean;
}) => {
  const modelCalls: Array<Array<{ role: string; content: string }>> = [];
  const leads: unknown[] = [];
  const records: Array<{ emailStatus: string }> = [];

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
    recordLead: async (record) => {
      if (options.recordFails) {
        throw new Error('database down');
      }

      records.push(record);
    },
  };

  return { deps, modelCalls, leads, records };
};

const turn = (message: string, id = sessionId, address = ip) => ({
  sessionId: id,
  message,
  ip: address,
});

const consentQuestion = 'May we contact you about your demo?\n[[options: Yes | No]]';

/** Starts a conversation whose last reply asked for consent, so a lead can be sent on the next turn. */
const consentAsked = async (deps: LandingPageChatDeps) => {
  const state = createChatState();
  const { callModel } = deps;
  deps.callModel = async () => ({ content: consentQuestion });
  await handleChatTurn(turn('Ready when you are'), deps, state);
  deps.callModel = callModel;

  return state;
};

describe('handleChatTurn Turnstile gate', () => {
  it('refuses a new session without a confirmed token, and makes no model call', async () => {
    const { deps, modelCalls } = fakeDeps({});
    const verified: Array<string | undefined> = [];
    deps.verifyTurnstile = async (token) => {
      verified.push(token);

      return false;
    };

    const result = await handleChatTurn(turn('What is meshX?'), deps, createChatState());

    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ code: 'landing_page.chat_verification_failed' });
    expect(verified).toEqual([undefined]);
    expect(modelCalls).toHaveLength(0);
  });

  it('starts a new session when the token is confirmed', async () => {
    const { deps, modelCalls } = fakeDeps({});
    deps.verifyTurnstile = async (token) => token === 'good-token';

    const result = await handleChatTurn(
      { ...turn('What is meshX?'), turnstileToken: 'good-token' },
      deps,
      createChatState()
    );

    expect(result.status).toBe(200);
    expect(modelCalls).toHaveLength(1);
  });

  it('checks the token once per session, and not again on later turns', async () => {
    const { deps } = fakeDeps({});
    const verified: string[] = [];
    deps.verifyTurnstile = async (token) => {
      verified.push(token ?? '');

      return true;
    };
    const state = createChatState();

    await handleChatTurn({ ...turn('First question'), turnstileToken: 'first' }, deps, state);
    await handleChatTurn(turn('A follow-up'), deps, state);

    expect(verified).toEqual(['first']);
  });
});

describe('handleChatTurn', () => {
  it('answers with the fallback and makes no model call while the kill switch is off', async () => {
    const previous = process.env.LANDING_CHAT_MODEL_ENABLED;
    process.env.LANDING_CHAT_MODEL_ENABLED = 'false';

    try {
      const { deps, modelCalls } = fakeDeps({});

      const result = await handleChatTurn(turn('What is meshX?'), deps, createChatState());

      expect(result.status).toBe(200);
      expect(modelCalls).toHaveLength(0);
    } finally {
      process.env.LANDING_CHAT_MODEL_ENABLED = previous;
    }
  });

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

  it('retries the model once when it fails transiently, then replies normally', async () => {
    const { deps, modelCalls } = fakeDeps({});
    const failures = { left: 1 };
    const { callModel } = deps;
    deps.callModel = async (messages, context) => {
      if (failures.left > 0) {
        failures.left -= 1;
        modelCalls.push(messages);
        throw new Error('Model returned 429');
      }

      return callModel(messages, context);
    };

    const result = await handleChatTurn(turn('What is meshX?'), deps, createChatState());

    expect(result).toEqual({
      status: 200,
      body: { reply: 'meshX connects your data to your AI.', submitted: false, options: [] },
    });
    expect(modelCalls).toHaveLength(2);
  });

  it('returns the model reply for a valid message', async () => {
    const { deps, modelCalls } = fakeDeps({});

    const result = await handleChatTurn(turn('What is meshX?'), deps, createChatState());

    expect(result).toEqual({
      status: 200,
      body: { reply: 'meshX connects your data to your AI.', submitted: false, options: [] },
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

    for (let index = 0; index < demoChatLimits.maxTurnsPerSession; index += 1) {
      await handleChatTurn(turn(`question ${index}`), deps, state);
    }

    const result = await handleChatTurn(turn('one more'), deps, state);

    expect(result.status).toBe(429);
    expect(result.body.code).toBe('landing_page.chat_turn_limit');
    expect(modelCalls).toHaveLength(demoChatLimits.maxTurnsPerSession);
  });

  it('delivers a valid lead once and then stops talking to the model', async () => {
    const { deps, modelCalls, leads } = fakeDeps({
      reply: { lead: validLead },
    });
    const state = await consentAsked(deps);

    const first = await handleChatTurn(turn('Yes, please contact me'), deps, state);
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
    expect(result.body).toEqual({
      reply: 'Before I send this, may we contact you about your demo?',
      submitted: false,
      options: ['Yes', 'No'],
    });
  });

  it('tells the visitor when delivery fails and keeps the session open', async () => {
    const { deps } = fakeDeps({ reply: { lead: validLead }, sendLeadFails: true });
    const state = await consentAsked(deps);

    const result = await handleChatTurn(turn('Yes, please contact me'), deps, state);

    expect(result.status).toBe(503);
    expect(result.body.code).toBe('landing_page.chat_delivery_failed');
    expect(state.sessions.get(sessionId)?.submitted).toBe(false);
  });

  it('records a delivered lead as pending, then sent', async () => {
    const { deps, records } = fakeDeps({ reply: { lead: validLead } });

    await handleChatTurn(turn('Yes, please contact me'), deps, await consentAsked(deps));

    expect(records.map((record) => record.emailStatus)).toEqual(['pending', 'sent']);
  });

  it('records a lead as failed when delivery fails, so the team can follow it up', async () => {
    const { deps, records } = fakeDeps({ reply: { lead: validLead }, sendLeadFails: true });

    await handleChatTurn(turn('Yes, please contact me'), deps, await consentAsked(deps));

    expect(records.map((record) => record.emailStatus)).toEqual(['pending', 'failed']);
  });

  it('keeps the visitor reply when a lead cannot be recorded', async () => {
    const { deps, leads } = fakeDeps({ reply: { lead: validLead }, recordFails: true });

    const result = await handleChatTurn(
      turn('Yes, please contact me'),
      deps,
      await consentAsked(deps)
    );

    expect(leads).toEqual([validLead]);
    expect(result.body.submitted).toBe(true);
  });

  it('keeps the visitor message and answers with a fallback when the model call fails', async () => {
    const { deps } = fakeDeps({ reply: 'throw' });
    const savedTurns: unknown[] = [];
    deps.recordTurn = async (saved) => {
      savedTurns.push(saved);
    };

    const result = await handleChatTurn(turn('What is meshX?'), deps, createChatState());

    expect(result.status).toBe(200);
    expect(JSON.stringify(result.body)).toContain('your message is saved');
    expect(savedTurns).toHaveLength(1);
    expect(JSON.stringify(savedTurns)).toContain('What is meshX?');
  });

  it('answers a failed turn in the visitor language when it is supported', async () => {
    const { deps } = fakeDeps({ reply: 'throw' });

    const result = await handleChatTurn(
      { ...turn('What is meshX?'), locale: 'de-DE' },
      deps,
      createChatState()
    );

    expect(JSON.stringify(result.body)).toContain('Ihre Nachricht ist gespeichert');
  });

  it('answers a failed turn in English when the visitor language is not supported', async () => {
    const { deps } = fakeDeps({ reply: 'throw' });

    const result = await handleChatTurn(
      { ...turn('What is meshX?'), locale: 'xx-YY' },
      deps,
      createChatState()
    );

    expect(JSON.stringify(result.body)).toContain('your message is saved');
  });

  it('makes exactly two model attempts when every attempt fails', async () => {
    const { deps, modelCalls } = fakeDeps({ reply: 'throw' });

    await handleChatTurn(turn('What is meshX?'), deps, createChatState());

    expect(modelCalls).toHaveLength(2);
  });

  it('caps new conversations per day across the instance', async () => {
    const { deps } = fakeDeps({});
    const state = createChatState();

    // The daily cap counts every new session; the next one is refused.
    for (let index = 0; index < demoChatLimits.maxSessionsPerDay; index += 1) {
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

    for (let index = 0; index < demoChatLimits.perIpPerMinute; index += 1) {
      await handleChatTurn(turn('hi', sessionId, '192.0.2.1'), deps, state);
    }

    const result = await handleChatTurn(turn('hi', sessionId, '192.0.2.1'), deps, state);

    expect(result.status).toBe(429);
    expect(result.body.code).toBe('landing_page.chat_rate_limited');
  });
});

/* eslint-enable @silverhand/fp/no-let, @silverhand/fp/no-mutation, @silverhand/fp/no-mutating-methods, no-await-in-loop */

describe('reply options', () => {
  it('returns the choices the reply ends with, and removes that line from the text', async () => {
    const { deps } = fakeDeps({
      reply: {
        content:
          'How would you like to be contacted?\n[[options: Email | WhatsApp | Phone call | LinkedIn]]',
      },
    });

    const result = await handleChatTurn(turn('Sure'), deps, createChatState());

    expect(result.body).toEqual({
      reply: 'How would you like to be contacted?',
      submitted: false,
      options: ['Email', 'WhatsApp', 'Phone call', 'LinkedIn'],
    });
  });
});

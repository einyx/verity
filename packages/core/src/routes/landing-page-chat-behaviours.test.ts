/* eslint-disable @silverhand/fp/no-let, @silverhand/fp/no-mutation, @silverhand/fp/no-mutating-methods, max-lines -- The scripted model replies are consumed in order, which needs mutable test state, and one test per visitor behaviour makes this file long by design. */
import { demoChatLimits } from './landing-page-chat-guard.js';
import { type ModelReply } from './landing-page-chat-reply.js';
import { createChatState, handleChatTurn, type LandingPageChatDeps } from './landing-page-chat.js';

// Twenty visitor behaviours, each run through the whole turn handler with a scripted model. These
// check how the server treats what the visitor sends and what the model returns. They do not judge the
// model's wording: that needs a live model run.

const enabledDocument = { demoChat: { enabled: true } };

/** Each test gets its own session id, because the abuse strike count is kept per session id. */
const sessionFor = (testNumber: number) =>
  `behaviour-${String(testNumber).padStart(2, '0')}-session`;
const ip = '198.51.100.20';

const validLead = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  company: 'Analytical Engines',
  consent: true,
};

const turn = (message: string, id: string) => ({ sessionId: id, message, ip });

/** Fake dependencies that return the scripted replies in order and record what the model was sent. */
const scripted = (replies: ModelReply[]) => {
  const modelCalls: Array<Array<{ role: string; content: string }>> = [];
  const leads: unknown[] = [];

  const deps: LandingPageChatDeps = {
    readPublished: async () => enabledDocument,
    callModel: async (messages) => {
      modelCalls.push(messages);
      const next = replies.shift();

      if (!next) {
        throw new Error('No scripted reply left.');
      }

      return next;
    },
    sendLead: async (lead) => {
      leads.push(lead);
    },
  };

  return { deps, modelCalls, leads };
};

describe('demo chat visitor behaviours', () => {
  it('1. a visitor who answers each question, then asks for WhatsApp, has the lead sent with that number', async () => {
    const { deps, leads } = scripted([
      { content: 'Great to have you here! Who do I have the pleasure of chatting with?' },
      { content: 'Lovely to meet you, Ada. Which company do you work for?' },
      { content: 'May we contact you about your demo?\n[[options: Yes | No]]' },
      {
        lead: {
          ...validLead,
          contactMethod: 'whatsapp',
          contactDetail: '+31 6 1234 5678',
        },
      },
    ]);
    const state = createChatState();
    const id = sessionFor(1);

    await handleChatTurn(turn('Hi, I am Ada', id), deps, state);
    await handleChatTurn(turn('Ada Lovelace', id), deps, state);
    await handleChatTurn(turn('Send it on WhatsApp, +31 6 1234 5678', id), deps, state);
    const result = await handleChatTurn(turn('Yes, you can contact me.', id), deps, state);

    expect(result.body.submitted).toBe(true);
    expect(leads).toEqual([
      expect.objectContaining({ contactMethod: 'whatsapp', contactDetail: '+31 6 1234 5678' }),
    ]);
  });

  it('2. a yes/no consent question shows Yes and No as buttons, not as text', async () => {
    const { deps } = scripted([
      {
        content: 'Where should our team send your tailored demo?\n[[options: Yes | No]]',
      },
    ]);

    const result = await handleChatTurn(turn('sure', sessionFor(2)), deps, createChatState());

    expect(result.body).toEqual({
      reply: 'Where should our team send your tailored demo?',
      submitted: false,
      options: ['Yes', 'No'],
    });
  });

  it('3. a contact-method list with five choices shows only the first four', async () => {
    const { deps } = scripted([
      {
        content:
          'How would you like to be contacted?\n[[options: Email | WhatsApp | Phone call | LinkedIn | Carrier pigeon]]',
      },
    ]);

    const result = await handleChatTurn(turn('hmm', sessionFor(3)), deps, createChatState());

    expect(result.body.options).toEqual(['Email', 'WhatsApp', 'Phone call', 'LinkedIn']);
  });

  it('4. an option longer than 40 characters is dropped and the rest are kept', async () => {
    const longOption = 'a'.repeat(41);
    const { deps } = scripted([
      { content: `Pick one?\n[[options: Email | ${longOption} | LinkedIn]]` },
    ]);

    const result = await handleChatTurn(turn('hmm', sessionFor(4)), deps, createChatState());

    expect(result.body.options).toEqual(['Email', 'LinkedIn']);
  });

  it('5. an options marker that is not the last line stays as plain text', async () => {
    const content = 'Pick one [[options: Yes | No]] and then tell me more.';
    const { deps } = scripted([{ content }]);

    const result = await handleChatTurn(turn('hmm', sessionFor(5)), deps, createChatState());

    expect(result.body).toEqual({ reply: content, submitted: false, options: [] });
  });

  it('6. a lead with an extra field the schema does not allow is not sent, and the visitor sees the reply', async () => {
    const { deps, leads } = scripted([
      {
        content: 'Could you confirm your email?',
        lead: { ...validLead, linkedinUrl: 'https://example.com/ada' },
      },
    ]);

    const result = await handleChatTurn(turn('here it is', sessionFor(6)), deps, createChatState());

    expect(leads).toHaveLength(0);
    expect(result.body).toEqual({
      reply: 'Could you share that once more?',
      submitted: false,
      options: [],
    });
  });

  it('7. a lead with a contact method the chat does not offer is not sent', async () => {
    const { deps, leads } = scripted([
      {
        content: 'Which contact method works best?',
        lead: { ...validLead, contactMethod: 'telegram', contactDetail: '@ada' },
      },
    ]);

    const result = await handleChatTurn(turn('telegram', sessionFor(7)), deps, createChatState());

    expect(leads).toHaveLength(0);
    expect(result.body.submitted).toBe(false);
  });

  it('8. a lead with no company is asked for consent, not for the company', async () => {
    const { deps, leads } = scripted([
      {
        content: 'Which company are you with?',
        lead: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', consent: true },
      },
    ]);

    const result = await handleChatTurn(turn('no company', sessionFor(8)), deps, createChatState());

    // The company is not asked for again: the consent is the only thing left.
    expect(leads).toHaveLength(0);
    expect(result.body.reply).toContain('may we contact you');
  });

  it('9. a first name that is only spaces is not sent', async () => {
    const { deps, leads } = scripted([
      {
        content: 'Who do I have the pleasure of chatting with?',
        lead: { ...validLead, firstName: '   ' },
      },
    ]);

    await handleChatTurn(turn('   ', sessionFor(9)), deps, createChatState());

    expect(leads).toHaveLength(0);
  });

  it('10. an email typed with spaces around it is trimmed before it is sent', async () => {
    const { deps, leads } = scripted([
      { content: 'May we contact you about your demo?\n[[options: Yes | No]]' },
      { lead: { ...validLead, email: '  Ada@Example.com  ' } },
    ]);
    const state = createChatState();

    await handleChatTurn(turn('my email', sessionFor(10)), deps, state);
    await handleChatTurn(turn('yes, email me', sessionFor(10)), deps, state);

    expect(leads).toEqual([expect.objectContaining({ email: 'Ada@Example.com' })]);
  });

  it('11. a message of exactly the maximum length is accepted', async () => {
    const { deps, modelCalls } = scripted([{ content: 'Thanks for the detail.' }]);

    const result = await handleChatTurn(
      turn('a'.repeat(demoChatLimits.maxMessageLength), sessionFor(11)),
      deps,
      createChatState()
    );

    expect(result.status).toBe(200);
    expect(modelCalls).toHaveLength(1);
  });

  it('12. a message one character over the maximum is refused before the model sees it', async () => {
    const { deps, modelCalls } = scripted([]);

    const result = await handleChatTurn(
      turn('a'.repeat(demoChatLimits.maxMessageLength + 1), sessionFor(12)),
      deps,
      createChatState()
    );

    expect(result.status).toBe(400);
    expect(modelCalls).toHaveLength(0);
  });

  it('13. a visitor who writes in Italian has the message passed to the model unchanged', async () => {
    const { deps, modelCalls } = scripted([
      { content: 'Happy to help. What is your data challenge?' },
    ]);

    await handleChatTurn(turn('  Ciao, cosa fa meshX?  ', sessionFor(13)), deps, createChatState());

    expect(modelCalls[0]?.at(-1)).toEqual({ role: 'user', content: 'Ciao, cosa fa meshX?' });
  });

  it('14. when the model returns no text and no lead, the visitor gets a plain follow-up question', async () => {
    const { deps } = scripted([{ content: '   ' }]);

    const result = await handleChatTurn(turn('...', sessionFor(14)), deps, createChatState());

    expect(result.body).toEqual({
      reply: 'Could you tell me a bit more?',
      submitted: false,
      options: [],
    });
  });

  it('15. a model reply longer than 1000 characters is cut to 1000 before the visitor sees it', async () => {
    const { deps } = scripted([{ content: 'b'.repeat(1200) }]);

    const result = await handleChatTurn(turn('go on', sessionFor(15)), deps, createChatState());

    expect(result.body.reply).toHaveLength(1000);
  });

  it('16. when the model returns a lead and text together, the lead is sent and the visitor gets the thank-you', async () => {
    const { deps, leads } = scripted([
      { content: 'May we contact you about your demo?\n[[options: Yes | No]]' },
      { content: 'Let me just check that for you.', lead: validLead },
    ]);

    const state = createChatState();
    await handleChatTurn(turn('Ada, Analytical Engines', sessionFor(16)), deps, state);
    const result = await handleChatTurn(turn('yes, send it', sessionFor(16)), deps, state);

    expect(leads).toEqual([validLead]);
    expect(result.body).toEqual({
      reply: 'Thanks. Your request is in, and the team will be in touch.',
      submitted: true,
    });
  });

  it('17. the first two abusive messages get a fixed warning and never reach the model', async () => {
    const { deps, modelCalls } = scripted([]);
    const state = createChatState();
    const id = sessionFor(17);
    const moderated = { ...deps, moderate: async (text: string) => text.includes('idiot') };

    const first = await handleChatTurn(turn('you idiot', id), moderated, state);
    const second = await handleChatTurn(turn('still an idiot', id), moderated, state);

    expect(first.status).toBe(200);
    expect(first.body.reply).toContain('keep this about meshX');
    expect(second.status).toBe(200);
    expect(modelCalls).toHaveLength(0);
  });

  it('18. the third abusive message closes the conversation, and later messages stay closed', async () => {
    const { deps, modelCalls } = scripted([]);
    const state = createChatState();
    const id = sessionFor(18);
    const moderated = { ...deps, moderate: async (text: string) => text.includes('idiot') };

    await handleChatTurn(turn('you idiot', id), moderated, state);
    await handleChatTurn(turn('idiot again', id), moderated, state);
    const third = await handleChatTurn(turn('idiot once more', id), moderated, state);
    const fourth = await handleChatTurn(turn('What is meshX?', id), moderated, state);

    expect(third.status).toBe(429);
    expect(third.body.code).toBe('landing_page.chat_closed_for_abuse');
    expect(fourth.body.code).toBe('landing_page.chat_closed_for_abuse');
    expect(modelCalls).toHaveLength(0);
  });

  it('19. when the abuse check is down, the chat stops and the model is not called', async () => {
    const { deps, modelCalls } = scripted([{ content: 'This should never be sent.' }]);
    const moderated = {
      ...deps,
      moderate: async () => {
        throw new Error('classifier timeout');
      },
    };

    const result = await handleChatTurn(
      turn('What is meshX?', sessionFor(19)),
      moderated,
      createChatState()
    );

    expect(result.status).toBe(502);
    expect(result.body.code).toBe('landing_page.chat_unavailable');
    expect(modelCalls).toHaveLength(0);
  });

  it('20. when the demo chat is switched off part way through, the next message is refused', async () => {
    let published: unknown = enabledDocument;
    const { deps, modelCalls } = scripted([
      { content: 'Happy to help.' },
      { content: 'Still here.' },
    ]);
    const toggled = { ...deps, readPublished: async () => published };
    const state = createChatState();
    const id = sessionFor(20);

    const first = await handleChatTurn(turn('What is meshX?', id), toggled, state);
    published = { demoChat: { enabled: false } };
    const second = await handleChatTurn(turn('And now?', id), toggled, state);

    expect(first.status).toBe(200);
    expect(second.status).toBe(404);
    expect(modelCalls).toHaveLength(1);
  });
});

describe('lead gate', () => {
  it('asks for the missing last name instead of sending a lead without one', async () => {
    const { deps, leads } = scripted([
      { content: 'Thanks, Ada.', lead: { ...validLead, lastName: '' } },
    ]);

    const result = await handleChatTurn(
      turn('Ada, Analytical Engines', sessionFor(21)),
      deps,
      createChatState()
    );

    expect(leads).toHaveLength(0);
    expect(result.body).toEqual({
      reply: 'Thanks, Ada.\n\nAnd your last name?',
      submitted: false,
      options: [],
    });
  });

  it('asks for the number when WhatsApp is chosen without one', async () => {
    const { deps, leads } = scripted([
      { content: 'May we contact you about your demo?\n[[options: Yes | No]]' },
      { content: 'Great.', lead: { ...validLead, contactMethod: 'whatsapp' } },
    ]);
    const state = createChatState();

    await handleChatTurn(turn('Hi', sessionFor(22)), deps, state);
    const result = await handleChatTurn(turn('WhatsApp, yes', sessionFor(22)), deps, state);

    expect(leads).toHaveLength(0);
    expect(result.body.reply).toBe('Great.\n\nWhat number or LinkedIn profile should we use?');
  });

  it('asks for consent before sending a lead the visitor has not yet agreed to', async () => {
    const { deps, leads } = scripted([{ content: 'Thanks.', lead: validLead }]);

    const result = await handleChatTurn(
      turn('Ada, Analytical Engines', sessionFor(23)),
      deps,
      createChatState()
    );

    expect(leads).toHaveLength(0);
    expect(result.body).toEqual({
      reply: 'Thanks.\n\nBefore I send this, may we contact you about your demo?',
      submitted: false,
      options: ['Yes', 'No'],
    });
  });
});

describe('consent answer', () => {
  it('never sends a lead after the visitor says no, and says so', async () => {
    const { deps, leads } = scripted([
      { content: 'May we contact you about your demo?\n[[options: Yes | No]]' },
      { lead: validLead },
    ]);
    const state = createChatState();
    const id = sessionFor(28);

    await handleChatTurn(turn('Ada, Analytical Engines', id), deps, state);
    const result = await handleChatTurn(turn('No thanks, not now', id), deps, state);

    expect(leads).toHaveLength(0);
    expect(result.body.submitted).toBe(false);
    expect(result.body.reply).toBe(
      'No problem at all, we will not send your details. You can still ask me anything about meshX.'
    );
  });
});

describe('lead side effects', () => {
  it('files the Kubo request and company research once when the visitor retries after an email failure', async () => {
    const { deps, leads } = scripted([
      { content: 'May we contact you about your demo?\n[[options: Yes | No]]' },
      { lead: validLead },
      { lead: validLead },
    ]);
    const provisioned: unknown[] = [];
    const researched: unknown[] = [];
    let emailAttempts = 0;
    const withEffects: LandingPageChatDeps = {
      ...deps,
      sendLead: async (lead) => {
        emailAttempts += 1;

        if (emailAttempts === 1) {
          throw new Error('mail down');
        }

        leads.push(lead);
      },
      provisionDemo: async (lead) => {
        provisioned.push(lead);
      },
      researchCompany: async (sessionId) => {
        researched.push(sessionId);
      },
    };
    const state = createChatState();
    const id = sessionFor(26);

    await handleChatTurn(turn('Ada, Analytical Engines', id), withEffects, state);
    const failed = await handleChatTurn(turn('yes', id), withEffects, state);
    const retried = await handleChatTurn(turn('yes, try again', id), withEffects, state);

    expect(failed.status).toBe(503);
    expect(retried.status).toBe(200);
    expect(emailAttempts).toBe(2);
    expect(leads).toHaveLength(1);
    expect(provisioned).toHaveLength(1);
    expect(researched).toHaveLength(1);
  });
});

describe('lead side effects across instances', () => {
  it('does not file the Kubo request again when another instance already saved the lead', async () => {
    const { deps, leads } = scripted([{ lead: validLead }]);
    const provisioned: unknown[] = [];
    const stored = {
      messages: [
        { role: 'user' as const, content: 'Ada, Analytical Engines' },
        {
          role: 'assistant' as const,
          content: 'May we contact you about your demo?\n[[options: Yes | No]]',
        },
      ],
      submitted: false,
    };
    const otherInstance: LandingPageChatDeps = {
      ...deps,
      loadSession: async () => stored,
      loadLeadFiled: async () => true,
      provisionDemo: async (lead) => {
        provisioned.push(lead);
      },
    };

    const result = await handleChatTurn(
      turn('yes', sessionFor(27)),
      otherInstance,
      createChatState()
    );

    expect(result.body.submitted).toBe(true);
    expect(leads).toHaveLength(1);
    expect(provisioned).toHaveLength(0);
  });
});

describe('store failures and reply reactions', () => {
  it('continues a conversation from this instance when the saved transcript cannot be read', async () => {
    const { deps, modelCalls } = scripted([
      { content: 'Happy to help.' },
      { content: 'Still here.' },
    ]);
    const state = createChatState();
    const id = sessionFor(29);

    await handleChatTurn(turn('What is meshX?', id), deps, state);
    const broken: LandingPageChatDeps = {
      ...deps,
      loadSession: async () => {
        throw new Error('database down');
      },
    };
    const result = await handleChatTurn(turn('And now?', id), broken, state);

    expect(result.status).toBe(200);
    expect(modelCalls).toHaveLength(2);
  });

  it('answers 503 when the saved transcript cannot be read and this instance has no copy', async () => {
    const { deps, modelCalls } = scripted([{ content: 'Happy to help.' }]);
    const broken: LandingPageChatDeps = {
      ...deps,
      loadSession: async () => {
        throw new Error('database down');
      },
    };

    const result = await handleChatTurn(
      turn('What is meshX?', sessionFor(30)),
      broken,
      createChatState()
    );

    expect(result.status).toBe(503);
    expect(result.body.code).toBe('landing_page.chat_unavailable');
    expect(modelCalls).toHaveLength(0);
  });

  it('keeps the model reaction and asks only one question when a lead is missing a field', async () => {
    const { deps } = scripted([
      {
        content: 'Lovely to meet you, Ada. Which company do you work for?',
        lead: { ...validLead, company: '' },
      },
    ]);

    const result = await handleChatTurn(turn('Ada', sessionFor(31)), deps, createChatState());

    expect(result.body.reply).toBe('Lovely to meet you, Ada.\n\nWhich company are you with?');
  });
});

describe('reply shape retry', () => {
  it('asks the model again when a reply has two questions, and shows the rewritten reply', async () => {
    const seen: Array<Array<{ role: string; content: string }>> = [];
    const replies = [
      { content: 'What is your role? And which team do you run?' },
      { content: 'Which team do you run?' },
    ];
    const deps: LandingPageChatDeps = {
      readPublished: async () => enabledDocument,
      callModel: async (messages) => {
        seen.push(messages);
        return replies.shift() ?? { content: 'ok' };
      },
      sendLead: async () => {
        // These tests never reach delivery.
      },
    };

    const result = await handleChatTurn(turn('Hi', sessionFor(24)), deps, createChatState());

    expect(seen).toHaveLength(2);
    expect(seen[1]?.at(-1)?.role).toBe('user');
    expect(seen[1]?.at(-1)?.content).toContain('ask one question only');
    expect(result.body.reply).toBe('Which team do you run?');
  });

  it('keeps the first reply when the retry fails', async () => {
    const bad = 'What is your role? And which team do you run?';
    let calls = 0;
    const deps: LandingPageChatDeps = {
      readPublished: async () => enabledDocument,
      callModel: async () => {
        calls += 1;

        if (calls === 1) {
          return { content: bad };
        }

        throw new Error('model down');
      },
      sendLead: async () => {
        // These tests never reach delivery.
      },
    };

    const result = await handleChatTurn(turn('Hi', sessionFor(25)), deps, createChatState());

    expect(result.status).toBe(200);
    expect(result.body.reply).toBe(bad);
  });
});

/* eslint-enable @silverhand/fp/no-let, @silverhand/fp/no-mutation, @silverhand/fp/no-mutating-methods, max-lines */

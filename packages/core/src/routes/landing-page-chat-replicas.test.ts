/* eslint-disable @silverhand/fp/no-mutating-methods -- The tests record each model call and the shared fake store. */
import { type RecordedChatMessage, type RecordedChatTurn } from './landing-page-chat-store.js';
import { createChatState, handleChatTurn, type LandingPageChatDeps } from './landing-page-chat.js';

// Two replicas, each with its own in-memory state, sharing one fake database. A visitor's next
// message can land on either replica, so every test alternates between them.
const sessionId = 'session-replica-0001';
const ip = '203.0.113.20';
const enabledDocument = { demoChat: { enabled: true } };

// Scripted replies shared by the tests below. They take no input, so they live outside each test.
const notedReply = () => ({ content: 'Thanks, noted.' });
const shortReply = () => ({ content: 'Thanks.' });

const validLead = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  company: 'Analytical Engines',
  consent: true,
};

type Store = Map<string, { messages: RecordedChatMessage[]; submitted: boolean }>;
type ModelCall = ReadonlyArray<{ role: string; content: string }>;

/** Builds the deps for one replica. All replicas share `store`, `modelCalls` and `sent`. */
const replicaDeps = (options: {
  store: Store;
  modelCalls: ModelCall[];
  reply: (turnIndex: number) => { content?: string; lead?: unknown };
  sent: unknown[];
}): LandingPageChatDeps => {
  return {
    readPublished: async () => enabledDocument,
    callModel: async (messages) => {
      // Turns are counted across every replica, so the scripted reply follows the conversation, not the instance.
      const turnIndex = options.modelCalls.length;
      options.modelCalls.push(messages.map((item) => ({ role: item.role, content: item.content })));
      return options.reply(turnIndex);
    },
    sendLead: async (lead) => {
      options.sent.push(lead);
    },
    recordTurn: async (turn: RecordedChatTurn) => {
      options.store.set(turn.sessionId, {
        messages: [...turn.messages],
        submitted: turn.submitted,
      });
    },
    loadSession: async (id) => options.store.get(id),
  };
};

const input = (message: string) => ({ sessionId, message, ip });

describe('landing page chat across replicas', () => {
  it('keeps the earlier turns when the next turn lands on another replica', async () => {
    const store: Store = new Map();
    const modelCalls: ModelCall[] = [];
    const sent: unknown[] = [];
    const reply = notedReply;

    const depsA = replicaDeps({ store, modelCalls, reply, sent });
    const depsB = replicaDeps({ store, modelCalls, reply, sent });
    const replicaA = createChatState();
    const replicaB = createChatState();

    // Name on A, then company on B, then email on A. Each later call must see every earlier message.
    await handleChatTurn(input('Test Lead01, Acme Logistics'), depsA, replicaA);
    await handleChatTurn(input('We run ops dashboards'), depsB, replicaB);
    await handleChatTurn(input('lead01@example.com'), depsA, replicaA);

    expect(modelCalls).toHaveLength(3);
    const lastCall = modelCalls[2] ?? [];
    const userTexts = lastCall.filter((item) => item.role === 'user').map((item) => item.content);
    expect(userTexts).toEqual([
      'Test Lead01, Acme Logistics',
      'We run ops dashboards',
      'lead01@example.com',
    ]);
  });

  it('does not lose the name typed on one replica when the next turn lands on another', async () => {
    const store: Store = new Map();
    const modelCalls: ModelCall[] = [];
    const sent: unknown[] = [];
    const reply = shortReply;

    const depsA = replicaDeps({ store, modelCalls, reply, sent });
    const depsB = replicaDeps({ store, modelCalls, reply, sent });

    await handleChatTurn(input('Test Lead02'), depsA, createChatState());
    await handleChatTurn(input('Acme Retail'), depsB, createChatState());

    // The second call's history must still hold the name the visitor typed on the first replica.
    const secondCall = modelCalls[1] ?? [];
    expect(secondCall.some((item) => item.role === 'user' && item.content === 'Test Lead02')).toBe(
      true
    );
  });

  it('submits the lead on a consent turn that lands on another replica', async () => {
    const store: Store = new Map();
    const modelCalls: ModelCall[] = [];
    const sent: unknown[] = [];
    const steps = [
      { content: 'Who should I contact?' },
      { content: 'May we contact you about your demo?\n[[options: Yes | No]]' },
      { content: 'Thanks, sending now.', lead: validLead },
    ];
    const reply = (turnIndex: number) => steps[turnIndex] ?? { content: 'ok' };

    const depsA = replicaDeps({ store, modelCalls, reply, sent });
    const depsB = replicaDeps({ store, modelCalls, reply, sent });
    const replicaA = createChatState();
    const replicaB = createChatState();

    await handleChatTurn(input('Hi'), depsA, replicaA);
    await handleChatTurn(input('Ada Lovelace'), depsB, replicaB);
    await handleChatTurn(input('ada@example.com, yes I agree'), depsA, replicaA);

    expect(sent).toHaveLength(1);
    expect(store.get(sessionId)?.submitted).toBe(true);
  });
});

/* eslint-enable @silverhand/fp/no-mutating-methods */

import { adminTenantId } from '@logto/schemas';
import { sql } from '@silverhand/slonik';
import Router from 'koa-router';
import { z } from 'zod';

import { EnvSet } from '#src/env-set/index.js';
import koaGuard from '#src/middleware/koa-guard.js';

import {
  createIpLimiter,
  createWindowLimiter,
  demoChatLimits,
  demoContactMethods,
  isDemoChatEnabled,
  isValidDemoChatMessage,
  parseDemoLead,
  type DemoLead,
} from './landing-page-chat-guard.js';
import { buildDocsQuery, createProductionDocsSearch } from './landing-page-docs.js';
import { systemPrompt } from './landing-page-chat-prompt.js';
import { parseAcsConnectionString, sendLeadEmail } from './landing-page-lead-email.js';

// Public demo chat on the landing page. Anonymous and model-backed, so the server enforces every limit:
// the published switch, the per-IP and daily caps, the turn cap, the lead schema, and the transcript.
// The model has one tool, `submit_lead`. The visitor never sees the model's raw tool arguments.

type ChatMessage = { role: 'user' | 'assistant'; content: string };

type ModelReply = { content?: string; lead?: unknown };

export type LandingPageChatDeps = {
  readPublished: () => Promise<unknown>;
  callModel: (messages: ChatMessage[], context?: string) => Promise<ModelReply>;
  sendLead: (lead: DemoLead) => Promise<void>;
  /** Reference text from the meshX docs for one visitor question, if any. */
  searchDocs?: (question: string) => Promise<string | undefined>;
};

type Session = {
  readonly messages: readonly ChatMessage[];
  readonly userTurns: number;
  readonly submitted: boolean;
};

type ChatState = {
  readonly sessions: Map<string, Session>;
  readonly ipLimiter: ReturnType<typeof createIpLimiter>;
  readonly sessionLimiter: ReturnType<typeof createWindowLimiter>;
};

export const createChatState = (): ChatState => ({
  sessions: new Map(),
  ipLimiter: createIpLimiter(),
  // The daily cap is per instance. It is not shared across instances, so it is a floor, not a ceiling.
  sessionLimiter: createWindowLimiter(demoChatLimits.maxSessionsPerDay, 86_400_000),
});
const submitLeadTool = {
  type: 'function' as const,
  function: {
    name: 'submit_lead',
    description:
      "Send the visitor's demo request to the meshX team. Call only after the visitor has given their details and agreed to be contacted.",
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['firstName', 'lastName', 'email', 'company', 'consent'],
      properties: {
        firstName: { type: 'string', maxLength: 80 },
        lastName: { type: 'string', maxLength: 80 },
        email: { type: 'string', maxLength: 254 },
        company: { type: 'string', maxLength: 120 },
        role: { type: 'string', maxLength: 120 },
        industry: { type: 'string', maxLength: 80 },
        interests: { type: 'array', items: { type: 'string', maxLength: 60 }, maxItems: 10 },
        decision: { type: 'string', maxLength: 200 },
        contactMethod: { type: 'string', enum: [...demoContactMethods] },
        contactDetail: { type: 'string', maxLength: 200 },
        consent: { type: 'boolean', enum: [true] },
      },
    },
  },
};

const sessionIdPattern = /^[\dA-Za-z-]{16,64}$/;

const thanks = 'Thanks. Your request is in, and the team will be in touch.';

type ChatResult = { status: number; body: Record<string, unknown> };

const error = (status: number, code: string, message: string): ChatResult => ({
  status,
  body: { code, message },
});

/** Checks that run before any model call. Returns a rejection, or undefined when the turn may proceed. */
const preflight = async (
  input: { sessionId: string; message: string; ip: string },
  deps: LandingPageChatDeps,
  state: ChatState
): Promise<ChatResult | undefined> => {
  if (!isDemoChatEnabled(await deps.readPublished())) {
    return error(404, 'landing_page.chat_disabled', 'Not found.');
  }

  if (!state.ipLimiter.allow(input.ip)) {
    return error(429, 'landing_page.chat_rate_limited', 'Too many requests.');
  }

  if (!sessionIdPattern.test(input.sessionId) || !isValidDemoChatMessage(input.message)) {
    return error(400, 'landing_page.chat_invalid', 'Invalid message.');
  }

  return undefined;
};

/** Gets the session for this id, or starts one within the daily cap. */
const openSession = (
  sessionId: string,
  state: ChatState
): { session: Session } | { rejection: ChatResult } => {
  const existing = state.sessions.get(sessionId);

  if (existing) {
    return { session: existing };
  }

  if (!state.sessionLimiter.allow('global')) {
    return {
      rejection: error(
        429,
        'landing_page.chat_daily_limit',
        'The chat is busy today. Please use the request form.'
      ),
    };
  }

  const session: Session = { messages: [], userTurns: 0, submitted: false };
  state.sessions.set(sessionId, session);

  return { session };
};

/** Calls the model. A failed call returns undefined so the visitor gets a clean error, not a stack trace. */
const findDocsContext = async (deps: LandingPageChatDeps, question: string) => {
  // A message that held only contact details leaves nothing to search for, so no search runs.
  if (!question) {
    return undefined;
  }

  try {
    return await deps.searchDocs?.(question);
  } catch {
    return undefined;
  }
};

const askModel = async (
  deps: LandingPageChatDeps,
  messages: ChatMessage[],
  context?: string
): Promise<ModelReply | undefined> => {
  try {
    return await deps.callModel(messages, context);
  } catch {}
};

/** Applies the model's reply: a valid lead is delivered, anything else is text for the visitor. */
const applyReply = async (
  turn: { sessionId: string; message: string; reply: ModelReply; session: Session },
  deps: LandingPageChatDeps,
  state: ChatState
): Promise<ChatResult> => {
  const { sessionId, message, reply, session } = turn;
  const lead = parseDemoLead(reply.lead);

  if (reply.lead !== undefined && lead) {
    try {
      await deps.sendLead(lead);
    } catch {
      // The visitor is told the request did not go through, so a lead is never lost silently.
      return error(
        503,
        'landing_page.chat_delivery_failed',
        'We could not send your request. Please try again or use the request form.'
      );
    }

    state.sessions.set(sessionId, {
      ...session,
      userTurns: session.userTurns + 1,
      submitted: true,
    });

    return { status: 200, body: { reply: thanks, submitted: true } };
  }

  const content = (reply.content ?? '').trim().slice(0, 1000) || 'Could you tell me a bit more?';

  state.sessions.set(sessionId, {
    ...session,
    messages: [
      ...session.messages,
      { role: 'user', content: message },
      { role: 'assistant', content },
    ],
    userTurns: session.userTurns + 1,
  });

  return { status: 200, body: { reply: content, submitted: false } };
};

/** One visitor turn. Returns the status and body to send. Pure apart from the injected dependencies. */
export const handleChatTurn = async (
  input: { sessionId: string; message: string; ip: string },
  deps: LandingPageChatDeps,
  state: ChatState
): Promise<ChatResult> => {
  const rejected = await preflight(input, deps, state);

  if (rejected) {
    return rejected;
  }

  const opened = openSession(input.sessionId, state);

  if ('rejection' in opened) {
    return opened.rejection;
  }

  const { session } = opened;

  if (session.submitted) {
    return { status: 200, body: { reply: thanks, submitted: true } };
  }

  if (session.userTurns >= demoChatLimits.maxTurnsPerSession) {
    return error(
      429,
      'landing_page.chat_turn_limit',
      'This conversation has reached its limit. Please use the request form.'
    );
  }

  const message = input.message.trim();

  // Only the server's own transcript is sent to the model, never a client-supplied history.
  const context = await findDocsContext(deps, buildDocsQuery(session.messages, message));
  const reply = await askModel(
    deps,
    [...session.messages, { role: 'user', content: message }],
    context
  );

  if (!reply) {
    return error(
      502,
      'landing_page.chat_unavailable',
      'The assistant is unavailable. Please try again or use the request form.'
    );
  }

  return applyReply({ sessionId: input.sessionId, message, reply, session }, deps, state);
};

const chatBodyGuard = z.object({
  sessionId: z.string().max(64),
  message: z.string().max(demoChatLimits.maxMessageLength),
});

/** Public route for the landing page chat. Mounted on the admin tenant, Cloud only. */
export const landingPageChatRoutes = (deps: LandingPageChatDeps, state = createChatState()) => {
  const router = new Router();

  router.post(
    '/api/landing-page/chat',
    koaGuard({ body: chatBodyGuard, status: [200, 400, 404, 429, 502, 503] }),
    async (ctx, next) => {
      const result = await handleChatTurn({ ...ctx.guard.body, ip: ctx.ip }, deps, state);

      ctx.status = result.status;
      ctx.body = result.body;

      return next();
    }
  );

  return router;
};

/** The shape of the model response this route reads. Anything else is treated as no reply. */
const modelResponseGuard = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullish(),
          tool_calls: z
            .array(
              z.object({
                function: z.object({ name: z.string(), arguments: z.string() }),
              })
            )
            .optional(),
        }),
      })
    )
    .min(1),
});

const readModelReply = (data: unknown): ModelReply => {
  const parsed = modelResponseGuard.safeParse(data);

  if (!parsed.success) {
    return {};
  }

  const message = parsed.data.choices[0]?.message;
  const call = message?.tool_calls?.find((item) => item.function.name === 'submit_lead');

  return {
    content: message?.content ?? undefined,
    lead: call ? parseArguments(call.function.arguments) : undefined,
  };
};

const parseArguments = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** Production wiring. The lead sender fails closed until the ACS transport is configured. */
export const createProductionChatDeps = (): LandingPageChatDeps => ({
  readPublished: async () => {
    const pool = await EnvSet.sharedPool;
    const row = await pool.maybeOne<{ published: unknown }>(sql`
      select published from landing_pages where tenant_id = ${adminTenantId}
    `);

    return row?.published;
  },
  callModel: async (messages, context) => {
    const endpoint = process.env.OPENAI_API_PROXY_ENDPOINT ?? 'https://api.openai.com/v1';
    const response = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL_NAME ?? 'gpt-4.1',
        max_tokens: 400,
        messages: [
          { role: 'system', content: systemPrompt },
          ...(context ? [{ role: 'system', content: context }] : []),
          ...messages,
        ],
        tools: [submitLeadTool],
      }),
    });

    if (!response.ok) {
      throw new Error(`Model returned ${response.status}`);
    }

    return readModelReply(await response.json());
  },
  searchDocs: createProductionDocsSearch(),
  sendLead: async (lead) => {
    // Fail closed: without both variables the lead is refused, and the visitor is told so.
    const connection = process.env.ACS_CONNECTION_STRING;
    const sender = process.env.ACS_SENDER_EMAIL;
    const parsed = connection ? parseAcsConnectionString(connection) : undefined;

    if (!parsed || !sender) {
      throw new Error('Lead delivery is not configured.');
    }

    await sendLeadEmail(lead, { ...parsed, sender });
  },
});

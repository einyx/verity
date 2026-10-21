import { adminTenantId } from '@logto/schemas';
import { sql } from '@silverhand/slonik';
import Router from 'koa-router';
import { z } from 'zod';

import { EnvSet } from '#src/env-set/index.js';
import koaGuard from '#src/middleware/koa-guard.js';

import { checkVisitorMessage, productionModerator } from './landing-page-abuse.js';
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
/* eslint-disable max-lines -- The chat route already exceeded the limit; the lead flow adds its own steps to the same handler. */
import { systemPrompt } from './landing-page-chat-prompt.js';
import { type ModelReply, readModelReply } from './landing-page-chat-reply.js';
import {
  type LeadRecord,
  recordLandingChatTurn,
  saveLeadCompanyProfile,
  saveLeadConversationInsight,
  recordLandingLead,
  recordLeadSafely,
  loadLandingChatSession,
  recordTurnSafely,
  type RecordedChatMessage,
  type RecordedChatTurn,
} from './landing-page-chat-store.js';
import {
  analyzeConversation,
  profileCompany,
  summarizeCompanyText,
} from './landing-page-company.js';
import { createDemoRequest } from './landing-page-demo-request.js';
import { buildDocumentsQuery, createProductionDocumentsSearch } from './landing-page-docs.js';
import { parseAcsConnectionString, sendLeadEmail } from './landing-page-lead-email.js';
import { signLeadFileQuery } from './landing-page-signed.js';
import { type SlackLeadInput, postLeadToSlack } from './landing-page-slack.js';

// Public demo chat on the landing page. Anonymous and model-backed, so the server enforces every limit:
// the published switch, the per-IP and daily caps, the turn cap, the lead schema, and the transcript.
// The model has one tool, `submit_lead`. The visitor never sees the model's raw tool arguments.

type ChatMessage = { role: 'user' | 'assistant'; content: string };

export type LandingPageChatDeps = {
  readPublished: () => Promise<unknown>;
  callModel: (messages: ChatMessage[], context?: string) => Promise<ModelReply>;
  sendLead: (lead: DemoLead) => Promise<void>;
  /** Whether a visitor message breaks the rules (abuse, harassment). Missing means no check. */
  moderate?: (text: string) => Promise<boolean>;
  /** Reference text from the meshX docs for one visitor question, if any. */
  searchDocs?: (question: string) => Promise<string | undefined>;
  /** Saves the conversation in the admin tenant. Optional, so the chat works without a store. */
  recordTurn?: (turn: RecordedChatTurn) => Promise<void>;
  /** Reads a saved conversation, so a turn served by another instance continues the same chat. */
  loadSession?: (sessionId: string) => Promise<{ messages: RecordedChatMessage[]; submitted: boolean } | undefined>;
  /** Saves each lead in the admin tenant, before and after the email. Optional, like recordTurn. */
  recordLead?: (lead: LeadRecord) => Promise<void>;
  /** Files the lead as a demo request with the Kubo portal. Optional; a failure never reaches the visitor. */
  provisionDemo?: (lead: DemoLead) => Promise<void>;
  /** Researches the lead's company from its public site and saves the profile. Runs in the background. */
  researchCompany?: (
    sessionId: string,
    email: string,
    messages: ReadonlyArray<{ role: string; content: string }>
  ) => Promise<void>;
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
const findDocumentsContext = async (deps: LandingPageChatDeps, question: string) => {
  // A message that held only contact details leaves nothing to search for, so no search runs.
  if (!question) {
    return;
  }

  try {
    return await deps.searchDocs?.(question);
  } catch {}
};

// One retry covers a transient model failure (timeout, rate limit) without leaving the visitor at an error.
const modelAttempts = 2;
const modelRetryDelayMs = 300;

const askModel = async (
  deps: LandingPageChatDeps,
  messages: ChatMessage[],
  context?: string
): Promise<ModelReply | undefined> => {
  for (let attempt = 1; attempt <= modelAttempts; attempt += 1) {
    try {
      return await deps.callModel(messages, context);
    } catch (error: unknown) {
      // Only the error message is logged: it names the status or the network failure, never the visitor's text.
      // eslint-disable-next-line no-console -- The chat route has no request logger, and this line holds no visitor content.
      console.error(
        `Landing page chat: model call failed on attempt ${attempt} of ${modelAttempts}: ${error instanceof Error ? error.message : 'unknown error'}`
      );

      if (attempt < modelAttempts) {
        await new Promise((resolve) => {
          setTimeout(resolve, modelRetryDelayMs);
        });
      }
    }
  }

  return undefined;
};

/** Signed links to a lead's brief and slides, or undefined when the link base or secret is not configured. */
const signedFileLinks = (sessionId: string) => {
  const base = process.env.LANDING_LEAD_FILES_BASE;
  const secret = process.env.LANDING_LEAD_LINK_SECRET;

  if (!base || !secret) {
    return;
  }

  const link = (kind: 'brief' | 'slides') =>
    `${base}/api/landing-lead-files/${kind}/${sessionId}?${signLeadFileQuery(secret, kind, sessionId)}`;

  return { brief: link('brief'), slides: link('slides') };
};

/** Runs company research for a lead. A failure is logged without the lead's details and changes nothing. */
const researchLeadCompany = async (
  research:
    | ((
        sessionId: string,
        email: string,
        messages: ReadonlyArray<{ role: string; content: string }>
      ) => Promise<void>)
    | undefined,
  sessionId: string,
  email: string,
  messages: ReadonlyArray<{ role: string; content: string }>
): Promise<void> => {
  try {
    await research?.(sessionId, email, messages);
  } catch {
    // eslint-disable-next-line no-console -- The chat route has no request logger, and this message holds no contact details.
    console.error('Landing page chat: the company profile could not be saved.');
  }
};

/**
 * Takes a trailing `[[options: A | B]]` line off a reply. The chat shows those choices as buttons, so the
 * visitor can tap a contact method or yes/no instead of typing it. At most four short options are kept.
 */
const splitReplyOptions = (content: string): { text: string; options: string[] } => {
  const match = /\n?\[\[options:\s*([^\]]+)]]\s*$/.exec(content);

  if (!match?.[1]) {
    return { text: content, options: [] };
  }

  const options = match[1]
    .split('|')
    .map((option) => option.trim())
    .filter((option) => option.length > 0 && option.length <= 40)
    .slice(0, 4);

  return { text: content.slice(0, match.index).trimEnd(), options };
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
    // The lead is saved first, so a failed email still leaves a record for the team to follow up.
    const record = { sessionId, lead, emailStatus: 'pending' as const };
    await recordLeadSafely(deps.recordLead, record);

    // Company research starts as soon as the lead is saved, not after the email, so a failed email
    // still leaves the company profile and the conversation analysis for the Leads page.
    void researchLeadCompany(deps.researchCompany, sessionId, lead.email, [
      ...session.messages,
      { role: 'user', content: message },
      { role: 'assistant', content: thanks },
    ]);

    // The Kubo demo request is filed whether or not the email goes out, so a mail outage never loses the demo.
    try {
      await deps.provisionDemo?.(lead);
    } catch {
      // The lead is saved, so the team can still follow up. The log names no details.
      // eslint-disable-next-line no-console -- The chat route has no request logger, and this message holds no contact details.
      console.error('Landing page chat: the Kubo demo request could not be filed.');
    }

    try {
      await deps.sendLead(lead);
    } catch {
      await recordLeadSafely(deps.recordLead, { ...record, emailStatus: 'failed' });
      // The visitor is told the request did not go through, so a lead is never lost silently.
      return error(
        503,
        'landing_page.chat_delivery_failed',
        'We could not send your request. Please try again or use the request form.'
      );
    }

    await recordLeadSafely(deps.recordLead, { ...record, emailStatus: 'sent' });

    state.sessions.set(sessionId, {
      ...session,
      userTurns: session.userTurns + 1,
      submitted: true,
    });

    await recordTurnSafely(deps.recordTurn, {
      sessionId,
      messages: [
        ...session.messages,
        { role: 'user', content: message },
        { role: 'assistant', content: thanks },
      ],
      lead,
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

  await recordTurnSafely(deps.recordTurn, {
    sessionId,
    messages: [
      ...session.messages,
      { role: 'user', content: message },
      { role: 'assistant', content },
    ],
    submitted: false,
  });

  const { text, options } = splitReplyOptions(content);

  return { status: 200, body: { reply: text, submitted: false, options } };
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

  // Another instance may have added turns since this one last saw the conversation. Always continue from
  // the saved transcript when one exists, so a stale copy here never drops a turn.
  if (deps.loadSession) {
    const stored = await deps.loadSession(input.sessionId);

    if (stored) {
      state.sessions.set(input.sessionId, {
        messages: stored.messages,
        userTurns: stored.messages.filter((item) => item.role === 'user').length,
        submitted: stored.submitted,
      });
    }
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

  if (deps.moderate) {
    const verdict = await checkVisitorMessage(input.sessionId, message, deps.moderate);

    if (verdict === 'unavailable') {
      // The check must run before the model sees a message, so when it cannot, the chat stays closed.
      return error(
        502,
        'landing_page.chat_unavailable',
        'The assistant is unavailable. Please try again or use the request form.'
      );
    }

    if (verdict === 'closed') {
      return error(
        429,
        'landing_page.chat_closed_for_abuse',
        'This conversation has been closed. Please use the request form instead.'
      );
    }

    if (verdict === 'warned') {
      return {
        status: 200,
        body: {
          reply:
            'Let’s keep this about meshX and your team’s data. What would you like to see in a demo?',
          submitted: false,
        },
      };
    }
  }

  const context = await findDocumentsContext(deps, buildDocumentsQuery(session.messages, message));
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
  moderate: productionModerator,
  searchDocs: createProductionDocumentsSearch(),
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
  recordTurn: async (turn) => {
    const pool = await EnvSet.sharedPool;
    await recordLandingChatTurn(pool, turn);
  },
  loadSession: async (sessionId) => {
    const pool = await EnvSet.sharedPool;
    return loadLandingChatSession(pool, sessionId);
  },
  recordLead: async (lead) => {
    const pool = await EnvSet.sharedPool;
    await recordLandingLead(pool, lead);
  },
  researchCompany: async (sessionId, email, messages) => {
    const endpoint = process.env.OPENAI_API_PROXY_ENDPOINT ?? 'https://api.openai.com/v1';
    const modelOptions = {
      endpoint,
      apiKey: process.env.OPENAI_API_KEY ?? '',
      model: process.env.OPENAI_MODEL_NAME ?? 'gpt-4.1',
      fetch,
    };
    const pool = await EnvSet.sharedPool;

    // The company profile and the conversation insight are independent: one failing does not stop the other.
    const profile = await profileCompany(email, {
      fetchPage: async (url, init) => fetch(url, init),
      summarize: async (text) => summarizeCompanyText(text, modelOptions),
    }).catch(() => null);

    if (profile) {
      await saveLeadCompanyProfile(pool, sessionId, profile);
    }

    const insight = await analyzeConversation(messages, modelOptions).catch(() => null);

    if (insight) {
      await saveLeadConversationInsight(pool, sessionId, insight);
    }

    // Post the completed lead to the sales channel. Off unless the channel's webhook is configured.
    const row = await pool.maybeOne<{
      lead: Record<string, unknown>;
      emailStatus: string;
      companyProfile: Record<string, unknown> | undefined;
    }>(sql`
      select lead, email_status as "emailStatus", company_profile as "companyProfile"
      from landing_leads
      where tenant_id = ${adminTenantId}
        and session_id = ${sessionId}
    `);

    if (row) {
      await postLeadToSlack(
        {
          // The lead was validated when it was saved; it is read back as stored.
          // eslint-disable-next-line no-restricted-syntax -- The stored lead is validated before it is saved.
          lead: row.lead as unknown as SlackLeadInput['lead'],
          emailStatus: row.emailStatus,
          leadsUrl: process.env.LANDING_LEAD_LEADS_URL,
          fileLinks: signedFileLinks(sessionId),
          // eslint-disable-next-line no-restricted-syntax -- The stored profile is written by this service only.
          profile: (row.companyProfile ?? undefined) as SlackLeadInput['profile'],
        },
        {
          webhookUrl: process.env.LANDING_LEAD_SLACK_WEBHOOK_URL,
          fetch: async (url, init) => fetch(url, init),
        }
      ).catch(() => {
        // The lead is saved either way. The log names no lead details.
        // eslint-disable-next-line no-console -- The chat route has no request logger, and this message holds no lead details.
        console.error('Landing page chat: the lead could not be posted to Slack.');
      });
    }
  },
  provisionDemo: async (lead) => {
    // Off unless the portal's shared token is configured, which matches the portal's own switch.
    await createDemoRequest(lead, {
      token: process.env.KUBO_DEMO_REQUEST_TOKEN,
      fetch: async (url, init) => fetch(url, init),
    });
  },
});
/* eslint-enable max-lines */

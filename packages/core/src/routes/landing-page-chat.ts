import { demoChatByLocale, demoChatEn } from '@logto/phrases';
import { adminTenantId } from '@logto/schemas';
import { sql } from '@silverhand/slonik';
import Router from 'koa-router';
import { z } from 'zod/v3';

import { EnvSet } from '#src/env-set/index.js';
import koaGuard from '#src/middleware/koa-guard.js';

import { checkVisitorMessage, productionModerator } from './landing-page-abuse.js';
import { assessCompanyBudget } from './landing-page-budget.js';
import {
  type ChatHitStore,
  createIpLimiter,
  createWindowLimiter,
  demoChatLimits,
  demoContactMethods,
  firstInvalidLeadField,
  isDemoChatEnabled,
  isValidDemoChatMessage,
  parseDemoLead,
  type DemoLead,
} from './landing-page-chat-guard.js';
/* eslint-disable max-lines -- The chat route already exceeded the limit; the lead flow adds its own steps to the same handler. */
import { systemPrompt } from './landing-page-chat-prompt.js';
import { type ModelReply, readModelReply } from './landing-page-chat-reply.js';
import { replyShapeProblems, shapeCorrection } from './landing-page-chat-shape.js';
import {
  type LeadRecord,
  pruneLandingChatRecords,
  recordLandingChatTurn,
  saveLeadCompanyProfile,
  saveLeadConversationInsight,
  recordLandingLead,
  recordLeadSafely,
  loadLandingChatSession,
  loadLandingLeadFiled,
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
import {
  parseAcsConnectionString,
  parseLeadRecipients,
  sendLeadEmail,
} from './landing-page-lead-email.js';
import { signLeadFileQuery } from './landing-page-signed.js';
import { type SlackLeadInput, postLeadToSlack } from './landing-page-slack.js';
import { verifyTurnstileToken } from './landing-page-turnstile.js';

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
  loadSession?: (
    sessionId: string
  ) => Promise<{ messages: RecordedChatMessage[]; submitted: boolean } | undefined>;
  /** Whether a lead is already saved for this conversation, so another instance does not file it again. */
  loadLeadFiled?: (sessionId: string) => Promise<boolean>;
  /**
   * Confirms the Turnstile token that a new chat session must carry. Optional, so tests run without it;
   * production always supplies it, and a missing or unconfirmed token refuses the session.
   */
  verifyTurnstile?: (token: string | undefined, ip: string) => Promise<boolean>;
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
  /** Set once the Kubo request and company research have run, so a retried lead does not repeat them. */
  readonly filed?: boolean;
};

type ChatState = {
  readonly sessions: Map<string, Session>;
  readonly ipLimiter: ReturnType<typeof createIpLimiter>;
  readonly sessionLimiter: ReturnType<typeof createWindowLimiter>;
};

/**
 * Limits are counted through `store`. Production passes the shared database store, so the per-IP and
 * daily limits hold across instances. Without one, counts are kept in memory for a single instance.
 */
export const createChatState = (store?: ChatHitStore): ChatState => ({
  sessions: new Map(),
  ipLimiter: createIpLimiter({ store }),
  sessionLimiter: createWindowLimiter(demoChatLimits.maxSessionsPerDay, 86_400_000, { store }),
});

/** Checks a limit, or returns undefined when the shared store cannot answer, so the caller fails closed. */
const checkLimit = async (allow: () => Promise<boolean>): Promise<boolean | undefined> => {
  try {
    return await allow();
  } catch {
    // The log names no details: the store failed, and the message holds no visitor content.
    // eslint-disable-next-line no-console -- The chat route has no request logger, and this line holds no visitor content.
    console.error('Landing page chat: a rate limit could not be checked.');

    return undefined;
  }
};
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

  const ipAllowed = await checkLimit(async () => state.ipLimiter.allow(input.ip));

  if (ipAllowed === undefined) {
    return error(
      503,
      'landing_page.chat_unavailable',
      'The assistant is unavailable. Please try again or use the request form.'
    );
  }

  if (!ipAllowed) {
    return error(429, 'landing_page.chat_rate_limited', 'Too many requests.');
  }

  if (!sessionIdPattern.test(input.sessionId) || !isValidDemoChatMessage(input.message)) {
    return error(400, 'landing_page.chat_invalid', 'Invalid message.');
  }

  return undefined;
};

/** Gets the session for this id, or starts one within the daily cap. */
const openSession = async (
  sessionId: string,
  state: ChatState
): Promise<{ session: Session } | { rejection: ChatResult }> => {
  const existing = state.sessions.get(sessionId);

  if (existing) {
    return { session: existing };
  }

  const dailyAllowed = await checkLimit(async () => state.sessionLimiter.allow('global'));

  if (dailyAllowed === undefined) {
    return {
      rejection: error(
        503,
        'landing_page.chat_unavailable',
        'The assistant is unavailable. Please try again or use the request form.'
      ),
    };
  }

  if (!dailyAllowed) {
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
// Bounds one model call, so a slow model cannot hold a visitor's request open.
const modelTimeoutMs = 15_000;
// Shown in place of a model reply when every attempt fails, in the visitor's language when it is supported.
// The visitor's message has already been saved.
const unavailableReply = (locale: string | undefined): string => {
  const requested = locale?.toLowerCase();
  const language = requested?.split('-')[0];
  const tag =
    Object.keys(demoChatByLocale).find((candidate) => candidate.toLowerCase() === requested) ??
    Object.keys(demoChatByLocale).find(
      (candidate) => candidate.toLowerCase().split('-')[0] === language
    );

  return (tag && demoChatByLocale[tag]?.model_unavailable) ?? demoChatEn.model_unavailable;
};

/**
 * Operations kill switch for model spend. Set LANDING_CHAT_MODEL_ENABLED=false to stop every model call.
 * Visitors then get the localized fallback reply, and their turns are still saved. The value comes from the
 * process environment, so changing it means restarting the service with the new value.
 */
const modelEnabled = () => process.env.LANDING_CHAT_MODEL_ENABLED !== 'false';

const askModel = async (
  deps: LandingPageChatDeps,
  messages: ChatMessage[],
  context?: string
): Promise<ModelReply | undefined> => {
  if (!modelEnabled()) {
    return undefined;
  }

  const attempts = Array.from({ length: modelAttempts }, (_, index) => index + 1);

  for (const attempt of attempts) {
    try {
      // eslint-disable-next-line no-await-in-loop -- each attempt must finish before deciding whether to retry.
      return await deps.callModel(messages, context);
    } catch (error: unknown) {
      // Only the error message is logged: it names the status or the network failure, never the visitor's text.
      // eslint-disable-next-line no-console -- The chat route has no request logger, and this line holds no visitor content.
      console.error(
        `Landing page chat: model call failed on attempt ${attempt} of ${modelAttempts}: ${error instanceof Error ? error.message : 'unknown error'}`
      );

      if (attempt < modelAttempts) {
        // eslint-disable-next-line no-await-in-loop -- the retry delay must elapse before the next attempt starts.
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

const consentQuestion =
  'Before I send this, may we contact you about your demo?\n[[options: Yes | No]]';

/** What to ask for when a proposed lead has a gap, named by the field that is missing. */
const leadQuestions: Record<string, string> = {
  firstName: 'What is your first name?',
  lastName: 'And your last name?',
  email: 'What is your work email?',
  company: 'Which company are you with?',
  contactMethod:
    'How would you like us to contact you?\n[[options: Email | WhatsApp | Phone call | LinkedIn]]',
  contactDetail: 'What number or LinkedIn profile should we use?',
  consent: consentQuestion,
};

const declinedReply =
  'No problem at all, we will not send your details. You can still ask me anything about meshX.';

/**
 * What the visitor's message answers, when the chat's last reply asked for consent with Yes | No.
 * A lead is only sent after an explicit yes; a no stops it. Anything else is not an answer.
 */
const consentAnswer = (session: Session, message: string): 'granted' | 'declined' | undefined => {
  const last = session.messages.at(-1);

  if (last?.role !== 'assistant' || !/\[\[options:\s*Yes\s*\|\s*No\s*]]/.test(last.content)) {
    return undefined;
  }

  if (/^\s*no\b|\b(don'?t|do not|not interested|no thanks)\b/i.test(message)) {
    return 'declined';
  }

  return /(?<!\p{L})(yes|yeah|yep|sure|ok|okay|si|sí|sì|go ahead)(?!\p{L})/iu.test(message)
    ? 'granted'
    : undefined;
};

/**
 * The question to ask instead of sending a lead the model proposed too early or with a gap. Undefined when
 * the lead can go, or when the model proposed no lead at all.
 */
type PendingAsk = {
  /** The question or message to show instead of sending the lead. */
  text: string;
  /** Whether the model's own sentences before the question should stay in the reply. */
  keepReaction: boolean;
};

const askBeforeSending = (
  proposed: unknown,
  session: Session,
  message: string
): PendingAsk | undefined => {
  if (proposed === undefined) {
    return undefined;
  }

  const answer = consentAnswer(session, message);

  if (answer === 'declined') {
    return { text: declinedReply, keepReaction: false };
  }

  if (!parseDemoLead(proposed)) {
    const field = firstInvalidLeadField(proposed) ?? '';

    return { text: leadQuestions[field] ?? 'Could you share that once more?', keepReaction: true };
  }

  return answer === 'granted' ? undefined : { text: consentQuestion, keepReaction: true };
};

/**
 * The model's sentences that are not questions, followed by the one question the chat asks. This keeps the
 * genuine reaction the prompt asks for, without a second question competing with the one we ask.
 */
const withReaction = (modelText: string | undefined, question: string): string => {
  const reaction = (modelText ?? '')
    .split(/(?<=[!.?])\s+/)
    .filter((sentence) => sentence.trim().length > 0 && !sentence.includes('?'))
    .join(' ')
    .trim();

  return reaction ? `${reaction}\n\n${question}` : question;
};

/** Applies the model's reply: a valid lead is delivered, anything else is text for the visitor. */
const applyReply = async (
  turn: { sessionId: string; message: string; reply: ModelReply; session: Session },
  deps: LandingPageChatDeps,
  state: ChatState
): Promise<ChatResult> => {
  const { sessionId, message, reply, session } = turn;
  const lead = parseDemoLead(reply.lead);
  const pending = askBeforeSending(reply.lead, session, message);

  if (lead && !pending) {
    // The lead is saved first, so a failed email still leaves a record for the team to follow up.
    const record = { sessionId, lead, emailStatus: 'pending' as const };
    await recordLeadSafely(deps.recordLead, record);

    // The Kubo request and company research run once per conversation. If the email fails and the visitor
    // tries again, the retry only sends the email; it must not file a second demo or post a second Slack message.
    if (!session.filed) {
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

      state.sessions.set(sessionId, { ...session, filed: true });
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

  const content = pending
    ? pending.keepReaction
      ? withReaction(reply.content, pending.text)
      : pending.text
    : (reply.content ?? '').trim().slice(0, 1000) || 'Could you tell me a bit more?';

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
/**
 * Another instance may have added turns since this one last saw the conversation. Always continue from
 * the saved transcript when one exists, so a stale copy here never drops a turn.
 */
/**
 * Returns false only when the saved transcript could not be read and this instance has no copy either, so the
 * turn cannot continue the conversation. A read failure with a local copy continues from that copy.
 */
const restoreSavedTranscript = async (
  sessionId: string,
  deps: LandingPageChatDeps,
  state: ChatState
): Promise<boolean> => {
  const existing = state.sessions.get(sessionId);

  try {
    const stored = deps.loadSession ? await deps.loadSession(sessionId) : undefined;
    // A lead row means the Kubo request and research already ran, even when another instance filed it.
    const filed =
      existing?.filed === true ||
      (deps.loadLeadFiled ? await deps.loadLeadFiled(sessionId) : false);

    if (!stored && !filed) {
      return true;
    }

    const base = stored
      ? {
          messages: stored.messages,
          userTurns: stored.messages.filter((item) => item.role === 'user').length,
          submitted: stored.submitted,
        }
      : (existing ?? { messages: [], userTurns: 0, submitted: false });

    state.sessions.set(sessionId, { ...base, filed });

    return true;
  } catch {
    // The log names no details: the read failed, and the message holds no visitor content.
    // eslint-disable-next-line no-console -- The chat route has no request logger, and this message holds no visitor content.
    console.error('Landing page chat: the saved conversation could not be read.');

    return existing !== undefined;
  }
};

/**
 * Asks the model once more when a text reply breaks the shape rules (more than one question, too many
 * sentences, a bullet list). The retry is not stored; the visitor gets whichever reply came last.
 */
const reshapeReply = async (
  deps: LandingPageChatDeps,
  messages: ChatMessage[],
  context: string | undefined,
  reply: ModelReply
): Promise<ModelReply> => {
  const problems =
    reply.lead === undefined && reply.content ? replyShapeProblems(reply.content) : [];

  if (problems.length === 0 || !reply.content) {
    return reply;
  }

  const retried = await askModel(
    deps,
    [
      ...messages,
      { role: 'assistant', content: reply.content },
      { role: 'user', content: shapeCorrection(problems) },
    ],
    context
  );

  return retried ?? reply;
};

/**
 * A session not held in memory after the transcript is restored is new. Only a new session has to pass the
 * Turnstile check, so a script without a token cannot open sessions or use up the daily cap.
 * Undefined when the turn may go on.
 */
const checkNewSession = async (
  input: { sessionId: string; ip: string; turnstileToken?: string },
  deps: LandingPageChatDeps,
  state: ChatState
): Promise<ChatResult | undefined> => {
  if (state.sessions.has(input.sessionId) || !deps.verifyTurnstile) {
    return undefined;
  }

  const verified = await deps.verifyTurnstile(input.turnstileToken, input.ip);

  return verified
    ? undefined
    : error(
        403,
        'landing_page.chat_verification_failed',
        'Please complete the check and try again.'
      );
};

/**
 * Restores the saved transcript, then checks a new session's Turnstile token. Returns the rejection to send,
 * or undefined when the turn may go on.
 */
const admitTurn = async (
  input: { sessionId: string; ip: string; turnstileToken?: string },
  deps: LandingPageChatDeps,
  state: ChatState
): Promise<ChatResult | undefined> => {
  const restored = await restoreSavedTranscript(input.sessionId, deps, state);

  if (!restored) {
    // 503, not 502: the failing dependency is our own store, not the model. The visitor sees the same message.
    return error(
      503,
      'landing_page.chat_unavailable',
      'The assistant is unavailable. Please try again or use the request form.'
    );
  }

  return checkNewSession(input, deps, state);
};

export const handleChatTurn = async (
  input: {
    sessionId: string;
    message: string;
    ip: string;
    locale?: string;
    turnstileToken?: string;
  },
  deps: LandingPageChatDeps,
  state: ChatState
): Promise<ChatResult> => {
  const rejected = await preflight(input, deps, state);

  if (rejected) {
    return rejected;
  }

  const admission = await admitTurn(input, deps, state);

  if (admission) {
    return admission;
  }

  const opened = await openSession(input.sessionId, state);

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
  const turnMessages: ChatMessage[] = [...session.messages, { role: 'user', content: message }];
  const firstReply = await askModel(deps, turnMessages, context);

  if (!firstReply) {
    // The model already had its retry. The visitor's message is kept and answered with a plain
    // fallback, so a failed model call never loses the turn.
    return applyReply(
      {
        sessionId: input.sessionId,
        message,
        reply: { content: unavailableReply(input.locale) },
        session,
      },
      deps,
      state
    );
  }

  const reply = await reshapeReply(deps, turnMessages, context, firstReply);

  return applyReply({ sessionId: input.sessionId, message, reply, session }, deps, state);
};

const chatBodyGuard = z.object({
  sessionId: z.string().max(64),
  message: z.string().max(demoChatLimits.maxMessageLength),
  // The visitor's browser language, so a fallback reply can be written in it. Optional; English is used otherwise.
  locale: z.string().max(16).optional(),
  // The Turnstile token for a new session. Only checked when the session is new.
  turnstileToken: z.string().max(2048).optional(),
});

/** Public route for the landing page chat. Mounted on the admin tenant, Cloud only. */
export const landingPageChatRoutes = (deps: LandingPageChatDeps, state = createChatState()) => {
  const router = new Router();

  router.post(
    '/api/landing-page/chat',
    koaGuard({ body: chatBodyGuard, status: [200, 400, 403, 404, 429, 502, 503] }),
    async (ctx, next) => {
      // Behind a trusted proxy, the last X-Forwarded-For entry is the one the nearest proxy added. Earlier
      // entries can be set by the visitor, so they are never used for the limit.
      const ip = ctx.request.ips.at(-1) ?? ctx.ip;
      const result = await handleChatTurn({ ...ctx.guard.body, ip }, deps, state);

      ctx.status = result.status;
      ctx.body = result.body;

      return next();
    }
  );

  // The Turnstile site key is public. The browser needs it to draw the check before a session starts.
  // Null means the check is not configured, and the browser then sends no token.
  router.get('/api/landing-page/chat/config', (ctx) => {
    ctx.body = { turnstileSiteKey: process.env.TURNSTILE_SITE_KEY ?? null };
  });

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
  // A new session without a token confirmed by Cloudflare is refused. A missing secret refuses too.
  verifyTurnstile: async (token, ip) =>
    verifyTurnstileToken(process.env.TURNSTILE_SECRET_KEY, token, ip),
  callModel: async (messages, context) => {
    const endpoint = process.env.OPENAI_API_PROXY_ENDPOINT ?? 'https://api.openai.com/v1';
    const response = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(modelTimeoutMs),
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
    const recipients = parseLeadRecipients(process.env.LANDING_PAGE_LEAD_RECIPIENTS);
    const parsed = connection ? parseAcsConnectionString(connection) : undefined;

    if (!parsed || !sender || recipients.length === 0) {
      throw new Error('Lead delivery is not configured.');
    }

    await sendLeadEmail(lead, { ...parsed, sender, recipients });
  },
  recordTurn: async (turn) => {
    const pool = await EnvSet.sharedPool;
    await recordLandingChatTurn(pool, turn);

    // Pruning runs on about one turn in a hundred. A failed prune is ignored, since the turn is saved.
    if (Math.random() < 0.01) {
      await pruneLandingChatRecords(pool).catch(() => null);
    }
  },
  loadSession: async (sessionId) => {
    const pool = await EnvSet.sharedPool;
    return loadLandingChatSession(pool, sessionId);
  },
  loadLeadFiled: async (sessionId) => {
    const pool = await EnvSet.sharedPool;
    return loadLandingLeadFiled(pool, sessionId);
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
    // Read only explicit customer-provided company and need, never infer them from site text.
    const stored = await pool
      .maybeOne<{ lead: unknown }>(
        sql`
      select lead from landing_leads
      where tenant_id = ${adminTenantId} and session_id = ${sessionId}
    `
      )
      .catch(() => null);
    const lead = z
      .object({ company: z.string().trim().min(1), decision: z.string().optional() })
      .safeParse(stored?.lead);

    // The company profile and the conversation insight are independent: one failing does not stop the other.
    const profile = await profileCompany(email, {
      fetchPage: async (url, init) => fetch(url, init),
      summarize: async (text) => summarizeCompanyText(text, modelOptions),
      ...(lead.success
        ? {
            assessBudget: async (sources: Array<{ url: string; text: string }>) =>
              assessCompanyBudget(
                { company: lead.data.company, businessNeed: lead.data.decision, sources },
                {
                  ...modelOptions,
                  endpoint: `${endpoint}/chat/completions`,
                }
              ),
          }
        : {}),
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

/*
 * Self-hosted leads handling (internal to Verity API).
 * For the leads section, we keep everything in our own Postgres + API.
 * Can be extended with richer CRM features modeled after self-hosted CRMs like Twenty or Atomic CRM.
 */
/* eslint-enable max-lines */

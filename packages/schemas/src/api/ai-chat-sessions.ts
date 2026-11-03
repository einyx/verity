import { z } from 'zod/v3';

export const chatTitleMaxCodePoints = 120;
export const chatSearchMaxCodePoints = 120;
export const chatAttachmentMaxBytes = 100 * 1024;
export const chatAttachmentMaxCount = 5;
export const chatComposerMaxBytes = 512 * 1024;
export const chatContentMaxCodeUnits = 8000;
export const chatContentMaxBytes = 32 * 1024;
export const chatSessionMaxCount = 200;
export const chatSessionMaxMessages = 2000;
export const chatSessionMaxStoredBytes = 8 * 1024 * 1024;
export const chatSessionPageSize = 30;
export const chatMessagePageSize = 50;
export const chatContextMaxMessages = 40;
export const chatLeaseHeartbeatMs = 20_000;
export const chatLeaseExpiryMs = 90_000;
export const chatModelTimeoutMs = 60_000;
export const chatReviewTtlMs = 5 * 60_000;
export const chatLandingReviewTtlMs = 30 * 60_000;

/** Conservative routing aid, not authorization. The dedicated review route has no write tools. */
export const isLandingPageReviewRequest = (text: string) =>
  /landing[\s-]*page/i.test(text) &&
  /\b(review|preview|suggest|critique|inspect)\b|\b(do not|don't|never)\s+(save|publish|change|edit)/i.test(
    text
  );

/** Trusted server context, deliberately absent from every public input guard. */
export type ChatScope = { tenantId: string; userId: string };

const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const revisionGuard = z.number().int().nonnegative().safe();
const idGuard = z.string().min(1);
const timestampGuard = z.string().datetime({ offset: true });
const codePointString = (max: number) =>
  z.string().refine((value) => [...value].length <= max, 'Too many Unicode code points');

export const chatTitleGuard = codePointString(chatTitleMaxCodePoints).refine(
  (value) => value.trim().length > 0,
  'Title cannot be empty'
);
export const chatSearchGuard = codePointString(chatSearchMaxCodePoints);
export const chatAttachmentGuard = z
  .object({
    id: idGuard,
    name: z.string().min(1),
    text: z.string().refine((value) => utf8Bytes(value) <= chatAttachmentMaxBytes),
  })
  .strict();

const composerFields = {
  text: z.string(),
  attachments: chatAttachmentGuard.array().max(chatAttachmentMaxCount),
};
type ChatInput = z.infer<z.ZodObject<typeof composerFields>>;

const withinComposerLimit = ({ text, attachments }: ChatInput) =>
  utf8Bytes(text) +
    attachments.reduce(
      (total, attachment) => total + utf8Bytes(attachment.name) + utf8Bytes(attachment.text),
      0
    ) <=
  chatComposerMaxBytes;

const chatInputGuard = z.object(composerFields).strict().refine(withinComposerLimit);

/** Stable, locale-independent version of the existing inline text-file format. */
export const serializeChatInput = ({ text, attachments }: ChatInput): string =>
  [
    ...attachments.map(({ name, text: content }) => `File: ${name}\n\`\`\`\n${content}\n\`\`\``),
    text.trim(),
  ]
    .filter(Boolean)
    .join('\n\n');

/** Does not mutate or truncate the original composer, including on rejection. */
export const validateChatInput = (
  input: ChatInput
): { ok: true; content: string } | { ok: false; error: 'content_limit' } => {
  if (!chatInputGuard.safeParse(input).success) {
    return { ok: false, error: 'content_limit' };
  }

  const content = serializeChatInput(input);

  if (
    content.length === 0 ||
    content.length > chatContentMaxCodeUnits ||
    utf8Bytes(content) > chatContentMaxBytes
  ) {
    return { ok: false, error: 'content_limit' };
  }

  return { ok: true, content };
};

export const chatSessionGuard = z
  .object({
    id: idGuard,
    title: chatTitleGuard,
    archivedAt: timestampGuard.nullable(),
    createdAt: timestampGuard,
    updatedAt: timestampGuard,
    revision: revisionGuard,
    transcriptRevision: revisionGuard,
  })
  .strict();
export type ChatSession = z.infer<typeof chatSessionGuard>;

export const chatComposerGuard = z
  .object({ ...composerFields, revision: revisionGuard, updatedAt: timestampGuard })
  .strict()
  .refine(withinComposerLimit);
export type ChatComposer = z.infer<typeof chatComposerGuard>;

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
const jsonValueGuard: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    jsonValueGuard.array(),
    z.record(jsonValueGuard),
  ])
);

/** Body is preserved exactly; the server additionally validates it against the selected tool. */
export const chatReviewGuard = z
  .object({
    originalActionId: idGuard,
    currentActionId: idGuard,
    tool: idGuard,
    body: z.record(jsonValueGuard),
    expiresAt: timestampGuard,
    state: z.enum(['pending', 'confirmed', 'executed', 'cancelled', 'expired']),
    isError: z.boolean().nullable(),
  })
  .strict();
export type ChatReview = z.infer<typeof chatReviewGuard>;

export const chatMessageGuard = z
  .object({
    id: idGuard,
    sequence: revisionGuard,
    turnId: idGuard,
    role: z.enum(['user', 'assistant']),
    content: z
      .string()
      .min(1)
      .max(chatContentMaxCodeUnits)
      .refine((value) => utf8Bytes(value) <= chatContentMaxBytes),
    createdAt: timestampGuard,
    reviews: chatReviewGuard.array(),
  })
  .strict();
export type ChatMessage = z.infer<typeof chatMessageGuard>;

export const chatTurnGuard = z
  .object({
    id: idGuard,
    requestId: z.string().uuid(),
    state: z.enum(['running', 'completed', 'failed', 'interrupted']),
    errorCode: z.string().nullable(),
    createdAt: timestampGuard,
    updatedAt: timestampGuard,
    completedAt: timestampGuard.nullable(),
    messageIds: idGuard.array(),
  })
  .strict();
export type ChatTurn = z.infer<typeof chatTurnGuard>;

const sessionSortTupleGuard = z.tuple([timestampGuard, idGuard]);
const messageSortTupleGuard = z.tuple([revisionGuard]);

const encodedCursorGuard = (
  tupleGuard: typeof sessionSortTupleGuard | typeof messageSortTupleGuard
) =>
  z
    .string()
    .min(1)
    .max(2048)
    .regex(/^[\w-]+$/u)
    .refine((value) => {
      try {
        // Use Web APIs rather than Node Buffer so this contract also runs in the console.
        const binary = globalThis.atob(value.replaceAll('-', '+').replaceAll('_', '/'));
        // Reject noncanonical base64url encodings too (including nonzero padding bits).
        if (
          globalThis.btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '') !==
          value
        ) {
          return false;
        }
        const decoded = new TextDecoder('utf8', { fatal: true }).decode(
          Uint8Array.from(binary, (character) => character.codePointAt(0) ?? 0)
        );
        return tupleGuard.safeParse(JSON.parse(decoded)).success;
      } catch {
        return false;
      }
    }, 'Invalid chat cursor');

/** Base64url JSON [updatedAt, id], in descending session sort order. */
export const chatSessionCursorGuard = encodedCursorGuard(sessionSortTupleGuard);
/** Base64url JSON [sequence], in descending message sort order. */
export const chatMessageCursorGuard = encodedCursorGuard(messageSortTupleGuard);
export const sessionPageGuard = <T extends z.ZodTypeAny>(itemGuard: T) =>
  z
    .object({
      items: itemGuard.array(),
      nextCursor: z.union([chatSessionCursorGuard, chatMessageCursorGuard]).nullable(),
    })
    .strict();
export type SessionPage<T> = { items: T[]; nextCursor: string | null };

export const createSessionInputGuard = z.object({ requestId: z.string().uuid() }).strict();
export type CreateSessionInput = z.infer<typeof createSessionInputGuard>;
export const updateSessionInputGuard = z
  .object({
    expectedRevision: revisionGuard,
    title: chatTitleGuard.optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine(({ title, archived }) => title !== undefined || archived !== undefined);
export type UpdateSessionInput = z.infer<typeof updateSessionInputGuard>;
export const updateComposerInputGuard = z
  .object({ expectedRevision: revisionGuard, ...composerFields })
  .strict()
  .refine(withinComposerLimit);
export type UpdateComposerInput = z.infer<typeof updateComposerInputGuard>;
export const createTurnInputGuard = z
  .object({
    requestId: z.string().uuid(),
    expectedTranscriptRevision: revisionGuard,
    composerRevision: revisionGuard,
    ...composerFields,
  })
  .strict()
  .refine(({ text, attachments }) => validateChatInput({ text, attachments }).ok);
export type CreateTurnInput = z.infer<typeof createTurnInputGuard>;

export const chatSessionErrorCodeGuard = z.enum([
  'not_found',
  'revision_conflict',
  'session_busy',
  'session_archived',
  'review_replaced',
  'content_limit',
  'ai_chat_not_configured',
  'ai_chat_unavailable',
]);
export type ChatSessionErrorCode = z.infer<typeof chatSessionErrorCodeGuard>;
export const chatSessionErrorGuard = z
  .object({
    error: chatSessionErrorCodeGuard,
    currentRevision: revisionGuard.optional(),
    turnId: idGuard.optional(),
  })
  .strict();

import { z } from 'zod';

// Guards for the public landing-page demo chat. The chat is anonymous, so everything here is enforced
// on the server: the published on/off switch, size and turn caps, rate limits, and the lead schema that
// must pass before anything is sent. Model output is never trusted for any of these checks.

export const demoChatLimits = {
  /** Requests per IP per minute. */
  perIpPerMinute: 60,
  /** Requests per IP per hour. */
  perIpPerHour: 120,
  /** User turns allowed in one conversation. */
  maxTurnsPerSession: 30,
  /** Characters allowed in one user message. */
  maxMessageLength: 4000,
  /** Sessions the chat may start per day, across the instance. */
  maxSessionsPerDay: 1000,
} as const;

/** Whether the published document has the demo chat switched on. Missing or malformed reads as off. */
export const isDemoChatEnabled = (published?: unknown): boolean => {
  if (typeof published !== 'object' || published === null) {
    return false;
  }

  const demoChat: unknown = Reflect.get(published, 'demoChat');

  return (
    typeof demoChat === 'object' && demoChat !== null && Reflect.get(demoChat, 'enabled') === true
  );
};

/**
 * The lead the chat may submit. Required fields are the same as the static form. The consent must be
 * `true`, and any unknown key is rejected so the model cannot add data the team never asked for.
 */
/** The ways a visitor can ask to be contacted, offered as the last question in the chat. */
export const demoContactMethods = ['email', 'whatsapp', 'phone', 'linkedin'] as const;

const demoLeadGuard = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    email: z.string().trim().email().max(254),
    company: z.string().trim().min(1).max(120),
    role: z.string().trim().max(120).optional(),
    industry: z.string().trim().max(80).optional(),
    interests: z.array(z.string().trim().max(60)).max(10).optional(),
    decision: z.string().trim().max(200).optional(),
    /** How the visitor wants to be contacted. Email uses the work email above. */
    contactMethod: z.enum(demoContactMethods).optional(),
    /** The phone number or LinkedIn profile, when the method is not email. */
    contactDetail: z.string().trim().max(200).optional(),
    consent: z.literal(true),
  })
  .strict()
  .superRefine((lead, context) => {
    // A phone, WhatsApp or LinkedIn request is useless without the number or profile to reach them on.
    if (lead.contactMethod && lead.contactMethod !== 'email' && !lead.contactDetail) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contactDetail'],
        message: 'A contact method other than email needs a number or profile link.',
      });
    }
  });

export type DemoLead = z.infer<typeof demoLeadGuard>;

/** Parses a lead proposed by the model. Returns undefined when it does not match the schema. */
export const parseDemoLead = (input: unknown): DemoLead | undefined => {
  const result = demoLeadGuard.safeParse(input);

  return result.success ? result.data : undefined;
};

/**
 * The first field that stops a proposed lead from being sent, so the chat can ask for it by name.
 * Undefined when the lead is valid or the problem is not tied to one field.
 */
export const firstInvalidLeadField = (input: unknown): string | undefined => {
  const result = demoLeadGuard.safeParse(input);

  return result.success ? undefined : result.error.issues[0]?.path[0]?.toString();
};

/** Whether a user message is within the length cap and not empty. */
export const isValidDemoChatMessage = (message: unknown): message is string =>
  typeof message === 'string' &&
  message.trim().length > 0 &&
  message.length <= demoChatLimits.maxMessageLength;

/**
 * Records a hit for a key in a window and returns whether it is within the limit. Shared stores count
 * across every instance; the default store keeps counts in memory for one instance.
 */
export type ChatHitStore = {
  hit: (key: string, windowMs: number, limit: number, now: number) => Promise<boolean>;
};

/** A sliding-window store kept in memory for one instance. */
const createMemoryHitStore = (): ChatHitStore => {
  const hits = new Map<string, number[]>();

  return {
    async hit(key, windowMs, limit, current) {
      const counterKey = `${windowMs}:${key}`;
      const recent = (hits.get(counterKey) ?? []).filter((time) => current - time < windowMs);
      const allowed = recent.length < limit;

      hits.set(counterKey, allowed ? [...recent, current] : recent);

      return allowed;
    },
  };
};

type LimiterOptions = { now?: () => number; store?: ChatHitStore };

/** A counter per key for one window. Rejects if the store fails, so callers can fail closed. */
export const createWindowLimiter = (
  limit: number,
  windowMs: number,
  options: LimiterOptions = {}
) => {
  const store = options.store ?? createMemoryHitStore();
  const now = options.now ?? (() => Date.now());

  return {
    /** Records a hit and resolves to whether it is within the limit. */
    async allow(key: string): Promise<boolean> {
      return store.hit(key, windowMs, limit, now());
    },
  };
};

/** Per-IP limits for the chat: a short burst window and an hourly window. Both must allow the hit. */
export const createIpLimiter = (options: LimiterOptions = {}) => {
  const perMinute = createWindowLimiter(demoChatLimits.perIpPerMinute, 60_000, options);
  const perHour = createWindowLimiter(demoChatLimits.perIpPerHour, 3_600_000, options);

  return {
    async allow(ip: string): Promise<boolean> {
      const minuteOk = await perMinute.allow(ip);
      const hourOk = await perHour.allow(ip);

      return minuteOk && hourOk;
    },
  };
};

import { z } from 'zod';

// Guards for the public landing-page demo chat. The chat is anonymous, so everything here is enforced
// on the server: the published on/off switch, size and turn caps, rate limits, and the lead schema that
// must pass before anything is sent. Model output is never trusted for any of these checks.

export const demoChatLimits = {
  /** Requests per IP per minute. */
  perIpPerMinute: 15,
  /** Requests per IP per hour. */
  perIpPerHour: 120,
  /** User turns allowed in one conversation. */
  maxTurnsPerSession: 8,
  /** Characters allowed in one user message. */
  maxMessageLength: 1000,
  /** Sessions the chat may start per day, across the instance. */
  maxSessionsPerDay: 100,
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
  .strict();

export type DemoLead = z.infer<typeof demoLeadGuard>;

/** Parses a lead proposed by the model. Returns undefined when it does not match the schema. */
export const parseDemoLead = (input: unknown): DemoLead | undefined => {
  const result = demoLeadGuard.safeParse(input);

  return result.success ? result.data : undefined;
};

/** Whether a user message is within the length cap and not empty. */
export const isValidDemoChatMessage = (message: unknown): message is string =>
  typeof message === 'string' &&
  message.trim().length > 0 &&
  message.length <= demoChatLimits.maxMessageLength;

/** A sliding-window counter per key, kept in memory for one instance. */
export const createWindowLimiter = (limit: number, windowMs: number, now = () => Date.now()) => {
  const hits = new Map<string, number[]>();

  return {
    /** Records a hit and returns whether it is within the limit. */
    allow(key: string): boolean {
      const current = now();
      const recent = (hits.get(key) ?? []).filter((time) => current - time < windowMs);
      const allowed = recent.length < limit;

      hits.set(key, allowed ? [...recent, current] : recent);

      return allowed;
    },
  };
};

/** Per-IP limits for the chat: a short burst window and an hourly window. Both must allow the hit. */
export const createIpLimiter = (now?: () => number) => {
  const perMinute = createWindowLimiter(demoChatLimits.perIpPerMinute, 60_000, now);
  const perHour = createWindowLimiter(demoChatLimits.perIpPerHour, 3_600_000, now);

  return {
    allow(ip: string): boolean {
      const minuteOk = perMinute.allow(ip);
      const hourOk = perHour.allow(ip);

      return minuteOk && hourOk;
    },
  };
};

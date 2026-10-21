/* eslint-disable @silverhand/fp/no-let, @silverhand/fp/no-mutation -- The window tests advance a fake clock in steps. */
import { defaultLandingPageContent } from '@logto/schemas';

import {
  createIpLimiter,
  createWindowLimiter,
  demoChatLimits,
  isDemoChatEnabled,
  isValidDemoChatMessage,
  parseDemoLead,
} from './landing-page-chat-guard.js';

const validLead = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  company: 'Analytical Engines',
  consent: true,
};

describe('isDemoChatEnabled', () => {
  // The shipped default turns the demo chat on (see landing-page-defaults.ts).
  it('is on for the shipped default copy', () => {
    expect(isDemoChatEnabled(defaultLandingPageContent)).toBe(true);
  });

  it('is on only when the published flag is exactly true', () => {
    expect(isDemoChatEnabled({ demoChat: { enabled: true } })).toBe(true);
    expect(isDemoChatEnabled({ demoChat: { enabled: 'true' } })).toBe(false);
    expect(isDemoChatEnabled({ demoChat: { enabled: 1 } })).toBe(false);
  });

  it('reads documents saved before the switch existed as off', () => {
    expect(isDemoChatEnabled({ hero: {} })).toBe(false);
    expect(isDemoChatEnabled(null)).toBe(false);
    expect(isDemoChatEnabled()).toBe(false);
  });
});

describe('parseDemoLead', () => {
  it('accepts a lead with the required fields and consent', () => {
    expect(parseDemoLead(validLead)).toEqual(validLead);
  });

  it('accepts a preferred contact method with its detail', () => {
    const lead = { ...validLead, contactMethod: 'whatsapp', contactDetail: '+44 7700 900123' };
    expect(parseDemoLead(lead)).toEqual(lead);
  });

  it('rejects an unknown contact method', () => {
    expect(parseDemoLead({ ...validLead, contactMethod: 'fax' })).toBeUndefined();
  });

  it('rejects a lead without consent', () => {
    expect(parseDemoLead({ ...validLead, consent: false })).toBeUndefined();
  });

  it('rejects an invalid email address', () => {
    expect(parseDemoLead({ ...validLead, email: 'not-an-email' })).toBeUndefined();
  });

  it('rejects unknown keys that the model may add', () => {
    expect(parseDemoLead({ ...validLead, bcc: 'attacker@example.com' })).toBeUndefined();
  });

  it('rejects an overlong company name', () => {
    expect(parseDemoLead({ ...validLead, company: 'x'.repeat(121) })).toBeUndefined();
  });
});

describe('isValidDemoChatMessage', () => {
  it('accepts a non-empty message within the cap', () => {
    expect(isValidDemoChatMessage('What does meshX do?')).toBe(true);
  });

  it('rejects empty, whitespace-only, non-string, and overlong messages', () => {
    expect(isValidDemoChatMessage('')).toBe(false);
    expect(isValidDemoChatMessage('   ')).toBe(false);
    expect(isValidDemoChatMessage(42)).toBe(false);
    expect(isValidDemoChatMessage('x'.repeat(demoChatLimits.maxMessageLength + 1))).toBe(false);
  });
});

describe('createWindowLimiter', () => {
  it('allows up to the limit within the window, then refuses', async () => {
    const limiter = createWindowLimiter(2, 1000, { now: () => 0 });

    expect(await limiter.allow('ip')).toBe(true);
    expect(await limiter.allow('ip')).toBe(true);
    expect(await limiter.allow('ip')).toBe(false);
  });

  it('frees a slot once the window has passed', async () => {
    let now = 0;
    const limiter = createWindowLimiter(1, 1000, { now: () => now });

    expect(await limiter.allow('ip')).toBe(true);
    expect(await limiter.allow('ip')).toBe(false);

    now = 1000;
    expect(await limiter.allow('ip')).toBe(true);
  });

  it('keeps keys independent', async () => {
    const limiter = createWindowLimiter(1, 1000, { now: () => 0 });

    expect(await limiter.allow('a')).toBe(true);
    expect(await limiter.allow('b')).toBe(true);
  });

  it('rejects when the shared store fails, so callers can fail closed', async () => {
    const limiter = createWindowLimiter(1, 1000, {
      store: {
        hit: async () => {
          throw new Error('database unavailable');
        },
      },
    });

    await expect(limiter.allow('ip')).rejects.toThrow('database unavailable');
  });
});

describe('createIpLimiter', () => {
  it('stops an IP at the per-minute burst limit, without affecting other IPs', async () => {
    let now = 0;
    const limiter = createIpLimiter({ now: () => now });

    const burst = await Promise.all(
      Array.from({ length: demoChatLimits.perIpPerMinute }, async () => limiter.allow('1.2.3.4'))
    );
    expect(burst.every(Boolean)).toBe(true);

    expect(await limiter.allow('1.2.3.4')).toBe(false);
    expect(await limiter.allow('5.6.7.8')).toBe(true);

    now = 60_000;
    expect(await limiter.allow('1.2.3.4')).toBe(true);
  });
});

/* eslint-enable @silverhand/fp/no-let, @silverhand/fp/no-mutation */

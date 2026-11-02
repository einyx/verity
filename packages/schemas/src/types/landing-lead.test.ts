import { describe, expect, it } from 'vitest';

import { demoLeadGuard, landingLeadsResponseGuard } from './landing-lead.js';

describe('authoritative landing lead contract', () => {
  it.each([
    {},
    { lastName: 'Lovelace' },
    { company: 'Analytical' },
    { lastName: 'Lovelace', company: 'Analytical' },
  ])('keeps declined fields absent in both producer and listing: %j', (optional) => {
    const input = { firstName: 'Ada', email: 'ada@example.com', consent: true, ...optional };
    const lead = demoLeadGuard.parse(input);
    const listing = landingLeadsResponseGuard.parse({
      leads: [
        {
          id: 'lead',
          sessionId: 'session',
          lead,
          status: 'qualified',
          emailStatus: 'sent',
          notes: 'CRM notes',
          tags: ['Priority'],
          createdAt: 123,
        },
      ],
      totalCount: 1,
    });
    expect(listing.leads[0]?.lead).toEqual(input);
    expect(listing.leads[0]?.notes).toBe('CRM notes');
  });

  it('still requires explicit consent and contact detail for non-email requests', () => {
    const lead = { firstName: 'Ada', email: 'ada@example.com' };
    expect(demoLeadGuard.safeParse(lead).success).toBe(false);
    expect(demoLeadGuard.safeParse({ ...lead, consent: false }).success).toBe(false);
    expect(
      demoLeadGuard.safeParse({ ...lead, consent: true, contactMethod: 'phone' }).success
    ).toBe(false);
    expect(
      demoLeadGuard.safeParse({ ...lead, consent: true, privateField: 'unasked' }).success
    ).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import { isSyntheticLandingLead } from './landing-lead-synthetic.js';

describe('synthetic landing leads', () => {
  it.each([
    { profile: { syntheticContact: true } },
    { profile: { researchStatus: 'fixture' } },
    { profile: { researchStatus: 'synthetic' } },
    { profile: { researchStatus: 'demo-data' } },
    { tags: [' TEST-DATA '] },
    { tags: ['Demo Data'] },
    { email: 'demo@example.invalid' },
    { profile: { domain: 'team.example.invalid' } },
  ])('recognizes existing markers: %j', (input) => {
    expect(isSyntheticLandingLead(input)).toBe(true);
  });

  it('does not classify genuine contacts or malformed advisory fields as synthetic', () => {
    expect(
      isSyntheticLandingLead({
        email: 'alex@company.test',
        profile: { researchStatus: 'researched' },
        tags: ['priority'],
      })
    ).toBe(false);
    expect(isSyntheticLandingLead({ email: null, profile: { domain: 1 }, tags: [1] })).toBe(false);
  });
});

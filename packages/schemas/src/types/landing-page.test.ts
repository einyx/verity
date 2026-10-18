import { describe, expect, it } from 'vitest';

import { defaultLandingPageContent } from './landing-page-defaults.js';
import { landingPageDocumentGuard } from './landing-page.js';

describe('landingPageDocumentGuard', () => {
  it('accepts the default content the site ships with', () => {
    expect(landingPageDocumentGuard.safeParse(defaultLandingPageContent).success).toBe(true);
  });

  it('rejects a document missing a section', () => {
    const { closingCta: _omitted, ...withoutClosing } = defaultLandingPageContent;
    expect(landingPageDocumentGuard.safeParse(withoutClosing).success).toBe(false);
  });

  it('rejects a card list with the wrong number of items', () => {
    const agents = {
      ...defaultLandingPageContent.agents,
      cards: defaultLandingPageContent.agents.cards.slice(0, 5),
    };
    expect(
      landingPageDocumentGuard.safeParse({ ...defaultLandingPageContent, agents }).success
    ).toBe(false);
  });

  it('rejects an empty headline line', () => {
    const hero = { ...defaultLandingPageContent.hero, headline: [''] };
    expect(landingPageDocumentGuard.safeParse({ ...defaultLandingPageContent, hero }).success).toBe(
      false
    );
  });

  it('rejects a link with an overlong label', () => {
    const hero = {
      ...defaultLandingPageContent.hero,
      primaryCta: { label: 'x'.repeat(121), href: '/demo' },
    };
    expect(landingPageDocumentGuard.safeParse({ ...defaultLandingPageContent, hero }).success).toBe(
      false
    );
  });
});

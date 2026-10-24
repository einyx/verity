import { describe, expect, it } from 'vitest';

import { defaultLandingPageContent } from './landing-page-defaults.js';
import { landingPageDocumentGuard } from './landing-page.js';

const parse = (document: unknown) => landingPageDocumentGuard.safeParse(document);

describe('landingPageDocumentGuard', () => {
  it('round-trips optional live element overrides without changing old documents', () => {
    const elements = {
      'header-link-1': { text: 'Platform', href: '#platform' },
      'trust-image': {
        src: 'https://cdn.example.com/a.webp',
        alt: 'Certification',
        fit: 'contain',
        x: 12,
        y: -20,
      },
    };
    expect(parse({ ...defaultLandingPageContent, elements })).toMatchObject({
      success: true,
      data: { elements },
    });
    expect(parse(defaultLandingPageContent).success).toBe(true);
  });

  it.each([
    // eslint-disable-next-line no-script-url -- Negative fixture verifies that executable URLs are rejected, never rendered.
    { href: 'javascript:alert(1)' },
    { href: '//evil.test' },
    { src: 'data:image/svg+xml,evil' },
    { x: 401 },
    { y: -401 },
    { fit: 'arbitrary' },
    { html: '<script />' },
  ])('rejects unsafe live element overrides: %j', (override) => {
    expect(
      parse({ ...defaultLandingPageContent, elements: { 'header-link-1': override } }).success
    ).toBe(false);
  });
  it('accepts the shipped default as an ordered sections-only document', () => {
    expect(parse(defaultLandingPageContent).success).toBe(true);
    expect(defaultLandingPageContent.sections.map(({ type }) => type)).toEqual([
      'hero',
      'fomo',
      'howItWorks',
      'agents',
      'platform',
      'products',
      'industries',
      'stories',
      'why',
      'trust',
      'closingCta',
    ]);
    expect(defaultLandingPageContent).not.toHaveProperty('hero');
  });

  it('accepts all custom block variants and preserves their structured fields', () => {
    const sections = [
      ...defaultLandingPageContent.sections,
      { id: 'editorial-1', type: 'text', heading: 'A new section', body: 'Useful detail.' },
      {
        id: 'visual-1',
        type: 'image',
        heading: 'A visual story',
        src: 'https://assets.example.com/visual.webp',
        alt: 'A team reviewing a workflow',
        caption: 'A workflow in action',
      },
      {
        id: 'action-1',
        type: 'cta',
        heading: 'Talk to our team',
        body: 'Explore the best next step.',
        buttonLabel: 'Contact us',
        buttonHref: '/contact',
      },
    ];
    expect(parse({ ...defaultLandingPageContent, sections }).success).toBe(true);
  });

  it('requires exactly one Hero and one Closing CTA', () => {
    const withoutHero = defaultLandingPageContent.sections.filter(({ type }) => type !== 'hero');
    const withoutClosing = defaultLandingPageContent.sections.filter(
      ({ type }) => type !== 'closingCta'
    );
    const withDuplicateHero = [
      ...defaultLandingPageContent.sections,
      { ...defaultLandingPageContent.sections[0], id: 'hero-copy' },
    ];
    expect(parse({ ...defaultLandingPageContent, sections: withoutHero }).success).toBe(false);
    expect(parse({ ...defaultLandingPageContent, sections: withoutClosing }).success).toBe(false);
    expect(parse({ ...defaultLandingPageContent, sections: withDuplicateHero }).success).toBe(
      false
    );
  });

  it('rejects duplicate IDs, unsupported types, and unsafe links', () => {
    const duplicateIds = defaultLandingPageContent.sections.map((section, index) =>
      index === 1
        ? { ...section, id: defaultLandingPageContent.sections[0]?.id ?? 'hero' }
        : section
    );
    const customCta = {
      id: 'unsafe-cta',
      type: 'cta',
      heading: 'Unsafe',
      body: 'Unsafe link',
      buttonLabel: 'Go',
      buttonHref: ['java', 'script:alert(1)'].join(''),
    };
    expect(parse({ ...defaultLandingPageContent, sections: duplicateIds }).success).toBe(false);
    expect(
      parse({
        ...defaultLandingPageContent,
        sections: [...defaultLandingPageContent.sections, customCta],
      }).success
    ).toBe(false);
    expect(
      parse({
        ...defaultLandingPageContent,
        sections: [
          ...defaultLandingPageContent.sections,
          { id: 'unknown', type: 'html', html: '<script />' },
        ],
      }).success
    ).toBe(false);
  });

  it('allows variable collections from one through twelve and rejects thirteen', () => {
    const fomo = defaultLandingPageContent.sections.find(({ type }) => type === 'fomo');
    expect(fomo?.type).toBe('fomo');
    if (fomo?.type !== 'fomo') {
      throw new Error('Default FOMO section missing');
    }

    const withCells = (count: number) =>
      defaultLandingPageContent.sections.map((section) =>
        section.id === fomo.id
          ? {
              ...section,
              cells: Array.from({ length: count }, () => ({ heading: 'Cell', body: 'Body' })),
            }
          : section
      );
    expect(parse({ ...defaultLandingPageContent, sections: withCells(1) }).success).toBe(true);
    expect(parse({ ...defaultLandingPageContent, sections: withCells(12) }).success).toBe(true);
    expect(parse({ ...defaultLandingPageContent, sections: withCells(13) }).success).toBe(false);
  });

  it('limits the page to forty sections', () => {
    const extra = defaultLandingPageContent.sections.find(
      ({ type }) => type !== 'hero' && type !== 'closingCta'
    );
    const sections = [
      ...defaultLandingPageContent.sections,
      ...Array.from({ length: 29 }, (_, index) => ({
        id: `extra-${index}`,
        type: 'text' as const,
        heading: 'Heading',
        body: 'Body',
      })),
    ];
    expect(sections).toHaveLength(40);
    expect(parse({ ...defaultLandingPageContent, sections }).success).toBe(true);
    expect(parse({ ...defaultLandingPageContent, sections: [...sections, extra] }).success).toBe(
      false
    );
  });
});

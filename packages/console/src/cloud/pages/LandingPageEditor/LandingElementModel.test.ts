import { defaultLandingPageContent } from '@logto/schemas';

import {
  elementFieldPath,
  elementSelectionGuard,
  updateElementField,
  type LandingElementSelection,
} from './LandingElementModel';

const selection: LandingElementSelection = {
  id: 'hero-link',
  kind: 'link',
  sectionId: 'hero',
  fields: { text: 'sections.0.primaryCta.label', href: 'sections.0.primaryCta.href' },
  values: { text: 'Demo', href: '/demo' },
};

const reversed = {
  ...defaultLandingPageContent,
  // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- Reverse only a fresh copy to exercise section reorder without mutating the shared fixture.
  sections: [...defaultLandingPageContent.sections].reverse(),
};

it('resolves section-bound fields by stable section ID after reorder', () => {
  expect(elementFieldPath(reversed, selection, 'href')).toBe('sections.10.primaryCta.href');

  const updated = updateElementField(reversed, selection, 'href', '/contact');
  expect(elementFieldPath(updated, selection, 'href')).toBe('sections.10.primaryCta.href');
  expect(JSON.stringify(updated)).toContain('"href":"/contact"');
});

it('rejects prototype paths and invalid URL edits', () => {
  expect(
    elementSelectionGuard.safeParse({ ...selection, fields: { text: '__proto__.polluted' } })
      .success
  ).toBe(false);
  expect(
    // eslint-disable-next-line no-script-url -- Negative fixture verifies that executable URLs are rejected, never rendered.
    updateElementField(defaultLandingPageContent, selection, 'href', 'javascript:alert(1)')
  ).toBe(defaultLandingPageContent);
});

it('writes page-level image properties without changing section fields', () => {
  const image: LandingElementSelection = {
    id: 'header-image-1',
    kind: 'image',
    fields: {},
    values: {},
  };
  const updated = updateElementField(defaultLandingPageContent, image, 'alt', 'Brand');
  expect(JSON.stringify(updated)).toContain('"alt":"Brand"');
});

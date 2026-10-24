import { defaultLandingPageContent } from '@logto/schemas';

import {
  landingPagePuckData,
  puckContentToSections,
  landingSectionComponentNames,
  isCustomLandingSectionComponent,
  puckSectionHeading,
} from './LandingSectionBlocks';

jest.mock('./LandingImageSourceField', () => ({ __esModule: true, default: () => null }));

it('adapts every canonical block to an editable Puck component and back', () => {
  const document = {
    ...defaultLandingPageContent,
    sections: [
      ...defaultLandingPageContent.sections,
      { id: 'text-1', type: 'text', heading: 'Heading', body: 'Body' },
    ],
  };
  const data = landingPagePuckData(document);

  expect(data.content).toHaveLength(document.sections.length);
  expect(data.content.map(({ type }) => type)).toEqual([
    ...defaultLandingPageContent.sections.map(({ type }) => landingSectionComponentNames[type]),
    landingSectionComponentNames.text,
  ]);
  expect(data.content.at(-1)).toMatchObject({ props: { id: 'text-1', section: { type: 'text' } } });
  expect(puckContentToSections(data.content)).toHaveLength(document.sections.length);
});

it('restores required singleton blocks and normalizes duplicate IDs created by block duplication', () => {
  const { content } = landingPagePuckData(defaultLandingPageContent);
  const duplicateHero = content.map((block, index) =>
    index === 1 ? { ...block, props: { ...block.props, id: content[0]?.props.id } } : block
  );
  const sections = puckContentToSections(duplicateHero, defaultLandingPageContent.sections);

  expect(sections.filter(({ type }) => type === 'hero')).toHaveLength(1);
  expect(new Set(sections.map(({ id }) => id)).size).toBe(sections.length);
  expect(sections.some(({ type }) => type === 'closingCta')).toBe(true);
});

it('distinguishes custom sections from built-in sections and reads headings from section props', () => {
  expect(isCustomLandingSectionComponent(landingSectionComponentNames.hero)).toBe(false);
  expect(isCustomLandingSectionComponent(landingSectionComponentNames.text)).toBe(true);
  expect(
    puckSectionHeading({
      type: landingSectionComponentNames.text,
      props: { id: 'text-1', section: { type: 'text', heading: 'Custom heading' } },
    })
  ).toBe('Custom heading');
});

it('restores both missing singletons in the existing prepend order without mutating prior sections', () => {
  const { content } = landingPagePuckData(defaultLandingPageContent);
  const optional = content.filter(
    ({ props }) => !['hero', 'closingCta'].includes(props.section.type)
  );
  const sections = puckContentToSections(optional, defaultLandingPageContent.sections);

  expect(sections.slice(0, 2).map(({ type }) => type)).toEqual(['closingCta', 'hero']);
  expect(optional).toHaveLength(content.length - 2);
});

it('rejects malformed section props while keeping valid neighboring sections and required sections', () => {
  const { content } = landingPagePuckData(defaultLandingPageContent);
  const sections = puckContentToSections(
    [
      { type: 'TextSection', props: { id: 'broken', section: { type: 'text', heading: 42 } } },
      { type: 'HeroSection', props: { id: 'broken-hero', section: { type: 'hero' } } },
      ...content,
    ],
    defaultLandingPageContent.sections
  );

  expect(sections).toEqual(defaultLandingPageContent.sections);
});

it('preserves additional section metadata rather than replacing sections with parsed copies', () => {
  const section = {
    id: 'text-1',
    type: 'text',
    heading: 'Title',
    body: 'Body',
    metadata: 'retained',
  };
  const { content } = landingPagePuckData({ sections: [section] });

  expect(content[0]?.props.section).toEqual(section);
  expect(puckContentToSections(content)).toEqual([section]);
});

it('omits malformed loaded sections before exposing them as typed Puck props', () => {
  expect(landingPagePuckData({ sections: [null, { type: 'text', heading: 42 }] }).content).toEqual(
    []
  );
});

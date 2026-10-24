import {
  defaultLandingPageContent,
  landingPageSectionGuard,
  type LandingPageSection,
} from '@logto/schemas';
import {
  type ComponentConfig,
  type Config,
  type CustomFieldRender,
  type Data,
} from '@puckeditor/core';

import ContentEditor, { isRecord } from './ContentEditor';
import LandingImageSourceField from './LandingImageSourceField';
import {
  isLandingSectionType,
  landingSectionTypes,
  type LandingSectionType,
} from './LandingSectionTypes';
import styles from './index.module.scss';

export type { LandingSectionType } from './LandingSectionTypes';
export type LandingSectionBlockProps = Record<string, { section: LandingPageSection }>;
type PageProps = { readonly document: unknown };

const landingSectionLabels: Record<LandingSectionType, string> = {
  hero: 'Hero',
  fomo: 'Problem and opportunity',
  howItWorks: 'How it works',
  agents: 'Agents',
  platform: 'Platform',
  products: 'Products',
  industries: 'Industries',
  stories: 'Customer stories',
  why: 'Why us',
  trust: 'Security and trust',
  closingCta: 'Closing call to action',
  text: 'Text section',
  image: 'Image section',
  cta: 'Call to action',
};

const landingSectionDescriptions: Record<LandingSectionType, string> = {
  hero: 'Opening message, introduction, and primary actions.',
  fomo: 'The business problem and intelligence-layer definition.',
  howItWorks: 'How the product works and its next-step action.',
  agents: 'Agent use cases and supporting proof.',
  platform: 'Platform capabilities and deployment context.',
  products: 'Product cards, descriptions, and destination links.',
  industries: 'Industry-specific messaging and actions.',
  stories: 'Customer story and outcome facts.',
  why: 'Differentiators and comparison points.',
  trust: 'Security commitments and trust details.',
  closingCta: 'Final conversion message and actions.',
  text: 'A heading and supporting text.',
  image: 'An uploaded image with accessible alt text.',
  cta: 'A message and destination button.',
};

void landingSectionDescriptions;

export const landingSectionComponentNames: Record<LandingSectionType, string> = {
  hero: 'HeroSection',
  fomo: 'FomoSection',
  howItWorks: 'HowItWorksSection',
  agents: 'AgentsSection',
  platform: 'PlatformSection',
  products: 'ProductsSection',
  industries: 'IndustriesSection',
  stories: 'StoriesSection',
  why: 'WhySection',
  trust: 'TrustSection',
  closingCta: 'ClosingCtaSection',
  text: 'TextSection',
  image: 'ImageSection',
  cta: 'CtaSection',
};

const customSectionTypes = new Set<LandingSectionType>(['text', 'image', 'cta']);

export const isCustomLandingSectionComponent = (componentName: string) =>
  landingSectionTypes.some(
    (type) => customSectionTypes.has(type) && landingSectionComponentNames[type] === componentName
  );

export const puckSectionHeading = (block: unknown): string => {
  if (!isRecord(block) || !isRecord(block.props)) {
    return '';
  }
  const { section } = block.props;
  if (!isRecord(section)) {
    return typeof block.type === 'string' ? block.type : '';
  }
  const heading = section.heading ?? section.headline;
  if (typeof heading === 'string') {
    return heading || String(block.type ?? '');
  }
  if (Array.isArray(heading) && heading.every((line) => typeof line === 'string')) {
    return heading.join(' ') || String(block.type ?? '');
  }
  return String(block.type ?? '');
};

const customDefaults: Partial<Record<LandingSectionType, LandingPageSection>> = {
  text: { id: '', type: 'text', heading: 'New section', body: 'Add supporting copy.' },
  image: { id: '', type: 'image', heading: 'New visual', src: '', alt: '', caption: '' },
  cta: {
    id: '',
    type: 'cta',
    heading: 'Ready to take the next step?',
    body: 'Tell visitors what happens next.',
    buttonLabel: 'Get in touch',
    buttonHref: '/contact',
  },
};

const defaultSection = (type: LandingSectionType): LandingPageSection => {
  const section =
    defaultLandingPageContent.sections.find((item) => item.type === type) ?? customDefaults[type];
  if (!section) {
    throw new Error(`No landing page defaults exist for section type: ${type}`);
  }
  return section;
};

const sectionField: CustomFieldRender<LandingPageSection> = ({ value, onChange }) => {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return <p>Section data is unavailable.</p>;
  }
  const { id: _id, type: _type, ...fields } = value;
  return (
    <div className={styles.sectionFields}>
      <ContentEditor
        label={
          isLandingSectionType(value.type) ? landingSectionLabels[value.type] : 'Section content'
        }
        value={fields}
        onChange={(next) => {
          if (isRecord(next)) {
            onChange({ ...value, ...next });
          }
        }}
      />
      {value.type === 'image' && (
        <LandingImageSourceField
          value={value.src}
          label="Image source"
          onChange={(src) => {
            onChange({ ...value, src });
          }}
        />
      )}
    </div>
  );
};

function SectionCanvas({ section }: { readonly section: LandingPageSection }) {
  const value: Record<string, unknown> = section;
  const heading = value.heading ?? value.headline ?? landingSectionLabels[section.type];
  const summary = value.lede ?? value.body ?? value.definition ?? 'Select to edit this section.';
  return (
    <article className={styles.landingSectionCard} data-section-type={section.type}>
      <small>{landingSectionLabels[section.type].toUpperCase()}</small>
      <h3>{Array.isArray(heading) ? heading.join(' ') : String(heading)}</h3>
      <p>{String(summary)}</p>
    </article>
  );
}

const components = Object.fromEntries(
  landingSectionTypes.map((type): [string, ComponentConfig<{ section: LandingPageSection }>] => [
    landingSectionComponentNames[type],
    {
      label: landingSectionLabels[type],
      fields: { section: { type: 'custom', label: 'Section content', render: sectionField } },
      defaultProps: { section: defaultSection(type) },
      resolvePermissions: (_data, { appState }) => ({
        delete: !['hero', 'closingCta'].includes(type),
        duplicate: !['hero', 'closingCta'].includes(type) && appState.data.content.length < 40,
      }),
      render: SectionCanvas,
    },
  ])
);

export const landingSectionConfig: Config<{
  components: LandingSectionBlockProps;
  root: PageProps;
}> = {
  components,
  categories: {
    builtIn: {
      title: 'Page sections',
      components: landingSectionTypes
        .filter((type) => !['text', 'image', 'cta'].includes(type))
        .map((type) => landingSectionComponentNames[type]),
    },
    custom: {
      title: 'Custom sections',
      components: landingSectionTypes
        .filter((type) => customSectionTypes.has(type))
        .map((type) => landingSectionComponentNames[type]),
    },
  },
  root: {
    fields: { document: { type: 'custom', label: 'Page', render: () => <div /> } },
    render: () => <div />,
  },
};

const idFor = (crypto: Partial<Crypto> | undefined) =>
  crypto?.randomUUID?.() ?? `section-${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Validate unknown input without stripping extra metadata from the editor's original section.
const isLandingPageSection = (section: unknown): section is LandingPageSection =>
  landingPageSectionGuard.safeParse(section).success;

export function puckContentToSections(
  content: unknown,
  previous: readonly LandingPageSection[] = []
): LandingPageSection[] {
  const blocks = Array.isArray(content) ? content : [];
  const seenIds = new Set<string>();
  const seenSingletons = new Set<string>();
  const sections = blocks.flatMap((block): LandingPageSection[] => {
    if (!isRecord(block) || !isRecord(block.props) || !isRecord(block.props.section)) {
      return [];
    }
    const { section } = block.props;
    if (!isLandingSectionType(section.type)) {
      return [];
    }
    if (
      (section.type === 'hero' || section.type === 'closingCta') &&
      seenSingletons.has(section.type)
    ) {
      return [];
    }
    const originalId: string =
      typeof block.props.id === 'string'
        ? block.props.id
        : typeof section.id === 'string'
          ? section.id
          : '';
    const id = !originalId || seenIds.has(originalId) ? idFor(globalThis.crypto) : originalId;
    const candidate = { ...section, id };
    if (!isLandingPageSection(candidate)) {
      return [];
    }
    seenIds.add(id);
    seenSingletons.add(candidate.type);
    return [candidate];
  });
  const restored = (['closingCta', 'hero'] as const).flatMap((type) => {
    const old = previous.find((section) => section.type === type);
    return !sections.some((section) => section.type === type) && old ? [old] : [];
  });
  return [...restored, ...sections].slice(0, 40);
}

export function landingPagePuckData(document: unknown): Data<LandingSectionBlockProps, PageProps> {
  const sections = isRecord(document) && Array.isArray(document.sections) ? document.sections : [];
  return {
    content: sections
      .filter((section: unknown) => isLandingPageSection(section))
      .map((section) => ({
        type: landingSectionComponentNames[section.type],
        props: { id: section.id, section },
      })),
    root: { props: { document } },
  };
}

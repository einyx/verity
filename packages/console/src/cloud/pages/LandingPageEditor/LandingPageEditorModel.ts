import {
  defaultLandingPageContent,
  type LandingPageSection as LandingSection,
} from '@logto/schemas';

type LandingSectionType = LandingSection['type'];
type LandingSectionPosition = 'before' | 'after' | 'end';

const requiredTypes = new Set<LandingSectionType>(['hero', 'closingCta']);

type SectionValue =
  | string
  | number
  | boolean
  | undefined
  | readonly SectionValue[]
  | { readonly [key: string]: SectionValue };

// Sections contain only JSON data. Recursing keeps the section type and nested copies without
// requiring structuredClone in older browsers or the test environment.
function cloneSectionValue<Value extends SectionValue>(value: Value): Value;
function cloneSectionValue(value: SectionValue): SectionValue {
  if (Array.isArray(value)) {
    return value.map((item: SectionValue) => cloneSectionValue(item));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]: [string, SectionValue]) => [
        key,
        cloneSectionValue(item),
      ])
    );
  }
  return value;
}

const cloneSection = (section: LandingSection): LandingSection => cloneSectionValue(section);

const customDefaults: Partial<Record<LandingSectionType, LandingSection>> = {
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

const newSection = (type: LandingSectionType, id: string): LandingSection => {
  const template =
    defaultLandingPageContent.sections.find((section) => section.type === type) ??
    customDefaults[type];
  if (!template) {
    throw new Error(`No landing page defaults exist for section type: ${type}`);
  }
  return { ...cloneSection(template), id };
};

const freshId = (sections: readonly LandingSection[], createId: () => string) => {
  const ids = new Set(sections.map(({ id }) => id));
  const nextId = (): string => {
    const attempt = createId();
    return ids.has(attempt) ? nextId() : attempt;
  };
  return nextId();
};

export function addLandingPageSection(
  sections: readonly LandingSection[],
  type: LandingSectionType,
  options: {
    readonly targetId?: string;
    readonly position?: LandingSectionPosition;
    readonly createId: () => string;
  }
): LandingSection[] {
  if (
    sections.length >= 40 ||
    (requiredTypes.has(type) && sections.some((item) => item.type === type))
  ) {
    return [...sections];
  }

  const block = newSection(type, freshId(sections, options.createId));
  const targetIndex = options.targetId
    ? sections.findIndex(({ id }) => id === options.targetId)
    : -1;
  const position = options.position ?? 'end';
  const insertAt =
    targetIndex < 0 || position === 'end'
      ? sections.findIndex(({ type: sectionType }) => sectionType === 'closingCta')
      : targetIndex + (position === 'after' ? 1 : 0);
  const index = insertAt < 0 ? sections.length : insertAt;

  return [...sections.slice(0, index), block, ...sections.slice(index)];
}

export function duplicateLandingPageSection(
  sections: readonly LandingSection[],
  sourceId: string,
  createId: () => string
): LandingSection[] {
  const sourceIndex = sections.findIndex(({ id }) => id === sourceId);
  const source = sections[sourceIndex];
  if (!source || sections.length >= 40 || requiredTypes.has(source.type)) {
    return [...sections];
  }

  const duplicate = { ...cloneSection(source), id: freshId(sections, createId) };
  return [...sections.slice(0, sourceIndex + 1), duplicate, ...sections.slice(sourceIndex + 1)];
}

export function moveLandingPageSection(
  sections: readonly LandingSection[],
  sourceId: string,
  destinationIndex: number
): LandingSection[] {
  const sourceIndex = sections.findIndex(({ id }) => id === sourceId);
  if (sourceIndex < 0 || !Number.isInteger(destinationIndex)) {
    return [...sections];
  }

  const boundedIndex = Math.max(0, Math.min(sections.length - 1, destinationIndex));
  const source = sections[sourceIndex];
  if (!source) {
    return [...sections];
  }

  const withoutSource = sections.filter((_, index) => index !== sourceIndex);
  return [...withoutSource.slice(0, boundedIndex), source, ...withoutSource.slice(boundedIndex)];
}

export function removeLandingPageSection(
  sections: readonly LandingSection[],
  sectionId: string
): LandingSection[] {
  const section = sections.find(({ id }) => id === sectionId);
  if (!section || requiredTypes.has(section.type)) {
    return [...sections];
  }

  return sections.filter(({ id }) => id !== sectionId);
}

import { type LandingPageSection } from '@logto/schemas';

export const landingSectionTypes = [
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
  'text',
  'image',
  'cta',
] as const satisfies ReadonlyArray<LandingPageSection['type']>;

export type LandingSectionType = (typeof landingSectionTypes)[number];

export const isLandingSectionType = (value: unknown): value is LandingSectionType => {
  const types: readonly unknown[] = landingSectionTypes;
  return types.includes(value);
};

export const sectionLabels = {
  hero: 'Hero',
  fomo: 'Missing layer',
  howItWorks: 'How it works',
  agents: 'Agents',
  platform: 'Platform',
  products: 'Products',
  industries: 'Industries',
  stories: 'Success stories',
  why: 'Why meshX',
  trust: 'Security',
  closingCta: 'Closing call to action',
} as const;

type SectionKey = keyof typeof sectionLabels;

export const sectionKeys: readonly SectionKey[] = [
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
];

export const sectionDescriptions: Record<SectionKey, string> = {
  hero: 'Opening message, introduction, and primary actions',
  fomo: 'The business problem and the intelligence-layer definition',
  howItWorks: 'How the product works and its next-step action',
  agents: 'Agent roles, examples, and supporting proof',
  platform: 'Platform capabilities and deployment context',
  products: 'Product cards, descriptions, and destination links',
  industries: 'Industry-specific messaging and calls to action',
  stories: 'Customer story and supporting outcome facts',
  why: 'Differentiators and comparison points',
  trust: 'Security commitments and trust details',
  closingCta: 'Final conversion message and action links',
};

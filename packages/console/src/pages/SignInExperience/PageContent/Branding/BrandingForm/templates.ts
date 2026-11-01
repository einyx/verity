import { generateDarkColor } from '@logto/core-kit';

/**
 * Pre-made sign-in colour templates. Choosing one fills the colour fields, so
 * the rest of the form stays editable. 'default' restores Logto's default colours,
 * so the dropdown can always switch back.
 */
const brandingTemplateIds = ['default', 'prysm-dark'] as const;

export type BrandingTemplateId = (typeof brandingTemplateIds)[number];

type BrandingTemplateValues = {
  primaryColor: string;
  isDarkModeEnabled: boolean;
  darkPrimaryColor: string;
};

const prysmInk = '#1f1f23';

// Logto's default sign-in colours, the same values the seed uses (packages/schemas/src/seeds).
const logtoDefaultPrimaryColor = '#6139F6';

export const brandingTemplates: Record<BrandingTemplateId, BrandingTemplateValues> = {
  default: {
    primaryColor: logtoDefaultPrimaryColor,
    isDarkModeEnabled: false,
    darkPrimaryColor: generateDarkColor(logtoDefaultPrimaryColor),
  },
  'prysm-dark': {
    primaryColor: prysmInk,
    isDarkModeEnabled: true,
    darkPrimaryColor: generateDarkColor(prysmInk),
  },
};

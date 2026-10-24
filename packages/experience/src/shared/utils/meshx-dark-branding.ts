import type { SignInExperienceResponse } from '@/types';

const meshxDarkPrimaryColors = new Set(['#da2c09', '#fe330a']);

type BrandingColor = Pick<SignInExperienceResponse['color'], 'primaryColor' | 'isDarkModeEnabled'>;

export const isMeshxDarkBranding = ({ primaryColor, isDarkModeEnabled }: BrandingColor) =>
  isDarkModeEnabled && meshxDarkPrimaryColors.has(primaryColor.toLowerCase());

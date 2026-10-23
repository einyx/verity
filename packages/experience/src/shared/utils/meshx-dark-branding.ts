import type { SignInExperienceResponse } from '@/types';

const meshxDarkPrimaryColor = '#fe330a';

type BrandingColor = Pick<SignInExperienceResponse['color'], 'primaryColor' | 'isDarkModeEnabled'>;

export const isMeshxDarkBranding = ({ primaryColor, isDarkModeEnabled }: BrandingColor) =>
  isDarkModeEnabled && primaryColor.toLowerCase() === meshxDarkPrimaryColor;

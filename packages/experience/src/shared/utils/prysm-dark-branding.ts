import type { SignInExperienceResponse } from '@/types';

const prysmDarkPrimaryColor = '#4f46e5';

type BrandingColor = Pick<SignInExperienceResponse['color'], 'primaryColor' | 'isDarkModeEnabled'>;

export const isPrysmDarkBranding = ({ primaryColor, isDarkModeEnabled }: BrandingColor) =>
  isDarkModeEnabled && primaryColor.toLowerCase() === prysmDarkPrimaryColor;

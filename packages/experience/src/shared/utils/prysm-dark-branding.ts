import type { SignInExperienceResponse } from '@/types';

const prysmDarkPrimaryColor = '#1f1f23';

type BrandingColor = Pick<SignInExperienceResponse['color'], 'primaryColor' | 'isDarkModeEnabled'>;

export const isPrysmDarkBranding = ({ primaryColor, isDarkModeEnabled }: BrandingColor) =>
  isDarkModeEnabled && primaryColor.toLowerCase() === prysmDarkPrimaryColor;

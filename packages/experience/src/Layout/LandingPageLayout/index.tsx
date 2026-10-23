import { type ConsentInfoResponse } from '@logto/schemas';
import classNames from 'classnames';
import type { TFuncKey } from 'i18next';
import type { ReactNode } from 'react';
import { useContext } from 'react';

import PageContext from '@/Providers/PageContextProvider/PageContext';
import BrandingHeader from '@/components/BrandingHeader';
import { getBrandingLogoUrl } from '@/shared/utils/logo';
import { isMeshxDarkBranding } from '@/shared/utils/meshx-dark-branding';
import { layoutClassNames } from '@/utils/consts';

import FirstScreenLayout from '../FirstScreenLayout';

import styles from './index.module.scss';

type ThirdPartyBranding = ConsentInfoResponse['application']['branding'];

type Props = {
  readonly children: ReactNode;
  readonly title: TFuncKey;
  readonly titleInterpolation?: Record<string, unknown>;
  readonly thirdPartyBranding?: ThirdPartyBranding;
};

const LandingPageLayout = ({ children, title, titleInterpolation, thirdPartyBranding }: Props) => {
  const { experienceSettings, theme } = useContext(PageContext);

  if (!experienceSettings) {
    return null;
  }

  const {
    color: { isDarkModeEnabled },
    branding,
  } = experienceSettings;
  const isMeshxDark = isMeshxDarkBranding(experienceSettings.color);

  return (
    <FirstScreenLayout pageMeta={{ titleKey: title, titleKeyInterpolation: titleInterpolation }}>
      <BrandingHeader
        className={classNames(styles.header, layoutClassNames.brandingHeader)}
        headline={title}
        headlineInterpolation={titleInterpolation}
        logo={
          isMeshxDark
            ? '/console/meshx-logo-dark.svg'
            : getBrandingLogoUrl({ theme, branding, isDarkModeEnabled })
        }
        thirdPartyLogo={
          thirdPartyBranding &&
          getBrandingLogoUrl({ theme, branding: thirdPartyBranding, isDarkModeEnabled })
        }
      />
      {children}
    </FirstScreenLayout>
  );
};

export default LandingPageLayout;

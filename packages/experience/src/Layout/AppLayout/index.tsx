import classNames from 'classnames';
import { useContext } from 'react';
import { Outlet } from 'react-router-dom';

import PageContext from '@/Providers/PageContextProvider/PageContext';
import usePlatform from '@/hooks/use-platform';
import PrysmSignature from '@/shared/components/PrysmSignature';
import { isPrysmDarkBranding } from '@/shared/utils/prysm-dark-branding';
import { layoutClassNames } from '@/utils/consts';

import CustomContent from './CustomContent';
import styles from './index.module.scss';

const AppLayout = () => {
  const { experienceSettings, theme } = useContext(PageContext);
  const { isMobile } = usePlatform();
  const hideLogtoBranding = experienceSettings?.hideLogtoBranding === true;
  const isPrysmDark =
    experienceSettings !== undefined && isPrysmDarkBranding(experienceSettings.color);

  return (
    <div className={classNames(styles.viewBox, isPrysmDark && styles.prysmViewBox)}>
      <div
        className={classNames(
          styles.container,
          layoutClassNames.pageContainer,
          isPrysmDark && styles.prysmContainer
        )}
      >
        {!isMobile && <CustomContent className={layoutClassNames.customContent} />}
        <main
          className={classNames(
            styles.main,
            layoutClassNames.mainContent,
            isPrysmDark && styles.prysmMain
          )}
        >
          <div className={isPrysmDark ? styles.prysmCard : undefined}>
            <Outlet />
            {!hideLogtoBranding && (
              <PrysmSignature
                className={classNames(styles.signature, layoutClassNames.signature)}
                theme={theme}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default AppLayout;

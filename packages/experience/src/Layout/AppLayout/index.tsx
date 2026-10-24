import classNames from 'classnames';
import { useContext } from 'react';
import { Outlet } from 'react-router-dom';

import PageContext from '@/Providers/PageContextProvider/PageContext';
import usePlatform from '@/hooks/use-platform';
import MeshxMark from '@/shared/assets/icons/meshx-mark.svg?react';
import LogtoSignature from '@/shared/components/LogtoSignature';
import { isMeshxDarkBranding } from '@/shared/utils/meshx-dark-branding';
import { layoutClassNames } from '@/utils/consts';

import CustomContent from './CustomContent';
import styles from './index.module.scss';

const AppLayout = () => {
  const { experienceSettings, theme } = useContext(PageContext);
  const { isMobile } = usePlatform();
  const hideLogtoBranding = experienceSettings?.hideLogtoBranding === true;
  const isMeshxDark =
    experienceSettings !== undefined && isMeshxDarkBranding(experienceSettings.color);
  const meshxLogo = (
    <a className={styles.meshxLogo} href="https://meshx.io" aria-label="MeshX">
      <MeshxMark aria-hidden="true" />
      <span>meshx</span>
    </a>
  );

  return (
    <div className={classNames(styles.viewBox, isMeshxDark && styles.meshxViewBox)}>
      <div
        className={classNames(
          styles.container,
          layoutClassNames.pageContainer,
          isMeshxDark && styles.meshxContainer
        )}
      >
        {isMeshxDark && !isMobile && (
          <aside className={styles.meshxHero}>
            {meshxLogo}
            <div className={styles.meshxHeroCopy}>
              <h1>
                Where enterprise
                <br />
                data becomes
                <br />
                <span>enterprise intelligence.</span>
              </h1>
              <p>
                Your Intelligence Layer — a living, queryable foundation of trusted knowledge,
                turning data into decisions, actions, and outcomes.
              </p>
            </div>
            <footer className={styles.meshxCopyright}>
              <MeshxMark aria-hidden="true" />
              <span>© 2026 meshx inc. All rights reserved.</span>
            </footer>
          </aside>
        )}
        {isMeshxDark && isMobile && <div className={styles.meshxMobileLogo}>{meshxLogo}</div>}
        {!isMobile && <CustomContent className={layoutClassNames.customContent} />}
        <main
          className={classNames(
            styles.main,
            layoutClassNames.mainContent,
            isMeshxDark && styles.meshxMain
          )}
        >
          <div className={isMeshxDark ? styles.meshxCard : undefined}>
            <Outlet />
            {!hideLogtoBranding && !isMeshxDark && (
              <LogtoSignature
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

import LogtoSignature from '@experience/shared/components/LogtoSignature';
import classNames from 'classnames';
import { useContext, useMemo } from 'react';
import { useLocation } from 'react-router-dom';

import MobileTabNav from '@ac/components/MobileTabNav';
import PageHeader from '@ac/components/PageHeader';
import Sidebar from '@ac/components/Sidebar';
import { layoutClassNames } from '@ac/constants/layout';

import styles from './App.module.scss';
import { AccountLayoutProvider } from './Providers/AccountLayoutContext';
import ErrorBoundary from './Providers/AppBoundary/ErrorBoundary';
import LogtoErrorBoundary from './Providers/AppBoundary/LogtoErrorBoundary';
import PageContext from './Providers/PageContextProvider/PageContext';
import { getAccountTabSettings } from './utils/account-tabs';

const AccountLayout = ({ children }: { readonly children: React.ReactElement }) => {
  const { accountCenterSettings, experienceSettings, theme, platform } = useContext(PageContext);
  const hideLogtoBranding = experienceSettings?.hideLogtoBranding === true;
  const { pathname } = useLocation();
  const accountNavItems = useMemo(
    () => getAccountTabSettings({ accountCenterSettings, experienceSettings }).navItems,
    [accountCenterSettings, experienceSettings]
  );
  const isFullPage = accountNavItems.some(({ to }) => to === pathname);
  const showsMultiPageNav = isFullPage && accountNavItems.length > 1;
  const showsMobileTabNav = platform === 'mobile' && showsMultiPageNav;
  const showsSidebar = platform !== 'mobile' && showsMultiPageNav;

  return (
    <div className={classNames(styles.app, layoutClassNames.app)}>
      <div
        className={classNames(
          styles.layout,
          isFullPage && styles.fullPage,
          showsMultiPageNav && layoutClassNames.withTabNav,
          layoutClassNames.pageContainer
        )}
      >
        {isFullPage && <PageHeader />}
        {showsMobileTabNav && <MobileTabNav items={accountNavItems} />}
        <div
          className={classNames(
            styles.container,
            !isFullPage && styles.cardContainer,
            !isFullPage && layoutClassNames.cardContainer,
            showsSidebar && styles.withSidebar,
            showsMobileTabNav && styles.withMobileTabNav
          )}
        >
          {showsSidebar && <Sidebar items={accountNavItems} />}
          <AccountLayoutProvider value={{ showsMultiPageNav, showsMobileTabNav }}>
            <main
              className={classNames(
                styles.main,
                !isFullPage && styles.cardMain,
                isFullPage ? layoutClassNames.mainContent : layoutClassNames.cardMain
              )}
            >
              <ErrorBoundary>
                <LogtoErrorBoundary>{children}</LogtoErrorBoundary>
              </ErrorBoundary>
              {!isFullPage && !hideLogtoBranding && (
                <LogtoSignature
                  className={classNames(styles.signature, layoutClassNames.signature)}
                  theme={theme}
                />
              )}
            </main>
          </AccountLayoutProvider>
        </div>
      </div>
    </div>
  );
};

export default AccountLayout;

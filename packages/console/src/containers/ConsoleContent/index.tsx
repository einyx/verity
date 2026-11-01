import { Theme } from '@logto/schemas';
import classNames from 'classnames';
import { Fragment, Suspense, useContext } from 'react';
import { useOutletContext, useRoutes } from 'react-router-dom';
import { safeLazy } from 'react-safe-lazy';

import DelayedSuspenseFallback from '@/components/DelayedSuspenseFallback';
import HostedEmailCapBanner from '@/components/HostedEmailCapBanner';
import OssLicenseBanner from '@/components/OssLicenseBanner';
import OssTenantMfaBanner from '@/components/OssTenantMfaBanner';
import ReadOnlyAccessNotification from '@/components/ReadOnlyAccessNotification';
import Topbar from '@/components/Topbar';
import { TenantsContext } from '@/contexts/TenantsProvider';
import OverlayScrollbar from '@/ds-components/OverlayScrollbar';
import { useConsoleRoutes } from '@/hooks/use-console-routes';
import { usePlausiblePageview } from '@/hooks/use-plausible-pageview';
import useTheme from '@/hooks/use-theme';

import type { AppContentOutletContext } from '../AppContent/types';

import { Skeleton } from './Sidebar';
import useShellNavigation from './Sidebar/use-shell-navigation';
import useTenantScopeListener from './hooks';
import styles from './index.module.scss';

const Sidebar = safeLazy(async () => import('./Sidebar'));

function ConsoleContent() {
  const theme = useTheme();
  const { scrollableContent } = useOutletContext<AppContentOutletContext>();
  const { currentTenantId } = useContext(TenantsContext);
  const routeObjects = useConsoleRoutes();
  const routes = useRoutes(routeObjects);
  const { active } = useShellNavigation();

  usePlausiblePageview(routeObjects, ':tenantId');
  // Use this hook here to make sure console listens to user tenant scope changes.
  useTenantScopeListener();

  return (
    <div className={classNames(styles.content, theme === Theme.Dark && styles.dark)}>
      <Suspense fallback={<Skeleton />}>
        <Sidebar />
      </Suspense>
      <div className={styles.workspace}>
        <Topbar isWorkspace>
          <nav aria-label="Current page" className={styles.breadcrumb}>
            {active && (
              <>
                <span>{active.section.label}</span>
                <strong aria-current="page">{active.item.label}</strong>
              </>
            )}
          </nav>
        </Topbar>
        <OverlayScrollbar className={styles.overlayScrollbarWrapper}>
          <div ref={scrollableContent} className={styles.main}>
            {/* Key by tenant so the banners' per-session dismissal state resets on tenant switch. */}
            <Fragment key={currentTenantId}>
              <HostedEmailCapBanner />
              <ReadOnlyAccessNotification />
            </Fragment>
            <OssTenantMfaBanner />
            <OssLicenseBanner />
            <Suspense fallback={<DelayedSuspenseFallback />}>{routes}</Suspense>
          </div>
        </OverlayScrollbar>
      </div>
    </div>
  );
}

export default ConsoleContent;

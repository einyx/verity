import { adminTenantId } from '@logto/schemas';
import { Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import TenantLanding from '@/cloud/pages/TenantLanding';
import DelayedSuspenseFallback from '@/components/DelayedSuspenseFallback';
import RedirectToAccountCenter from '@/components/RedirectToAccountCenter';
import { EnterpriseSubscriptionTabs } from '@/consts';
import { isCloud } from '@/consts/env';
import ProtectedRoutes from '@/containers/ProtectedRoutes';
import { GlobalAnonymousRoute, GlobalRoute } from '@/contexts/TenantsProvider';
import { OnboardingApp } from '@/onboarding';
import AcceptInvitation from '@/pages/AcceptInvitation';
import Callback from '@/pages/Callback';
import CheckoutSuccessCallback from '@/pages/CheckoutSuccessCallback';
import ExternalGoogleOneTapLanding from '@/pages/ExternalGoogleOneTapLanding';
import OneTimeTokenLanding from '@/pages/OneTimeTokenLanding';

import styles from './AppRoutes.module.scss';
import ConsoleSso from './pages/ConsoleSso';
import ConsoleSsoDetails from './pages/ConsoleSso/Details';
import DeleteAccount from './pages/DeleteAccount';
import EnterpriseSubscription from './pages/EnterpriseSubscription';
import BillingHistory from './pages/EnterpriseSubscription/BillingHistory';
import Subscription from './pages/EnterpriseSubscription/Subscription';
import Main from './pages/Main';
import SelfHostedLicenses from './pages/SelfHostedLicenses';
import SocialDemoCallback from './pages/SocialDemoCallback';

/** Renders necessary routes when the user is not in a tenant context. */
function AppRoutes() {
  return (
    <div className={styles.app}>
      <Suspense fallback={<DelayedSuspenseFallback />}>
        <Routes>
          {/*
           * The Console root opens the tenant of the signed-in user, so it needs the Logto
           * context. It lives here, inside the providers, and not in the app's own routes.
           */}
          <Route path="/" element={<TenantLanding />} />
          {/* Sign-in can return to `/console` under the base path, which is then matched as `/console/console`. */}
          <Route path="console" element={<TenantLanding />} />
          <Route path={GlobalAnonymousRoute.Callback} element={<Callback />} />
          <Route path={GlobalAnonymousRoute.SocialDemoCallback} element={<SocialDemoCallback />} />
          <Route
            path={GlobalAnonymousRoute.OneTimeTokenLanding}
            element={<OneTimeTokenLanding />}
          />
          <Route
            path={GlobalAnonymousRoute.ExternalGoogleOneTapLanding}
            element={<ExternalGoogleOneTapLanding />}
          />
          <Route
            path={`${GlobalRoute.AcceptInvitation}/:invitationId`}
            element={<AcceptInvitation />}
          />
          <Route element={<ProtectedRoutes />}>
            {isCloud && (
              <Route
                path={`${GlobalRoute.SelfHostedLicenses}/:licenseId?`}
                element={<SelfHostedLicenses />}
              />
            )}
            {/* Landing page CMS editor for the marketing site; dev feature, admin tenant only in practice. */}
            {isCloud && (
              <Route
                path={GlobalRoute.LandingPage}
                element={<Navigate replace to={`/${adminTenantId}${GlobalRoute.LandingPage}`} />}
              />
            )}
            {/* Console SSO */}
            {isCloud && (
              <>
                <Route path={GlobalRoute.ConsoleSso} element={<ConsoleSso />} />
                <Route
                  path={`${GlobalRoute.ConsoleSso}/:connectorId/:tab?`}
                  element={<ConsoleSsoDetails />}
                />
              </>
            )}
            <Route path={GlobalRoute.Profile + '/*'} element={<RedirectToAccountCenter />} />
            <Route
              path={GlobalRoute.CheckoutSuccessCallback}
              element={<CheckoutSuccessCallback />}
            />
            <Route path={GlobalRoute.Onboarding + '/*'} element={<OnboardingApp />} />
            <Route path={GlobalRoute.DeleteAccount} element={<DeleteAccount />} />
            <Route index element={<Main />} />
            <Route
              path={`${GlobalRoute.EnterpriseSubscription}/:logtoEnterpriseId`}
              element={<EnterpriseSubscription />}
            >
              <Route
                index
                element={<Navigate replace to={EnterpriseSubscriptionTabs.Subscription} />}
              />
              <Route path={EnterpriseSubscriptionTabs.Subscription} element={<Subscription />} />
              <Route
                path={EnterpriseSubscriptionTabs.BillingHistory}
                element={<BillingHistory />}
              />
            </Route>
          </Route>
        </Routes>
      </Suspense>
    </div>
  );
}

export default AppRoutes;

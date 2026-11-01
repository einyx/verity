import { ReservedScope, UserScope } from '@logto/core-kit';
import { LogtoProvider, useLogto } from '@logto/react';
import { accountCenterApplicationId, SignInIdentifier } from '@logto/schemas';
import { useContext } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import AppBoundary from '@ac/Providers/AppBoundary';
import LoadingContextProvider from '@ac/Providers/LoadingContextProvider';

import AccountLayout from './AccountLayout';
import Callback, { CallbackError } from './Callback';
import PageContextProvider from './Providers/PageContextProvider';
import PageContext from './Providers/PageContextProvider/PageContext';
import ErrorPage from './components/ErrorPage';
import GlobalLoading from './components/GlobalLoading';
import {
  securityRoute,
  sessionsRoute,
  profileRoute,
  emailRoute,
  emailSuccessRoute,
  phoneRoute,
  phoneSuccessRoute,
  passwordRoute,
  passwordSuccessRoute,
  usernameRoute,
  usernameSuccessRoute,
  authenticatorAppRoute,
  authenticatorAppReplaceRoute,
  authenticatorAppSuccessRoute,
  authenticatorAppReplaceSuccessRoute,
  backupCodesGenerateRoute,
  backupCodesRegenerateRoute,
  backupCodesSuccessRoute,
  backupCodesManageRoute,
  passkeyAddRoute,
  passkeyManageRoute,
  passkeySuccessRoute,
  socialSuccessRoute,
  socialCallbackRoutePrefix,
  socialRoutePrefix,
  verifiedActionRoute,
} from './constants/routes';
import initI18n from './i18n/init';
import BackupCodeBinding from './pages/BackupCodeBinding';
import BackupCodeView from './pages/BackupCodeView';
import Email from './pages/Email';
import Home from './pages/Home';
import PasskeyBinding from './pages/PasskeyBinding';
import PasskeyView from './pages/PasskeyView';
import Password from './pages/Password';
import Phone from './pages/Phone';
import Profile from './pages/Profile';
import Security from './pages/Security';
import Sessions from './pages/Sessions';
import SocialCallback from './pages/SocialCallback';
import SocialFlow from './pages/SocialFlow';
import TotpBinding from './pages/TotpBinding';
import UpdateSuccess from './pages/UpdateSuccess';
import Username from './pages/Username';
import VerifiedAction from './pages/VerifiedAction';
import { useAuthRedirect } from './use-auth-redirect';
import { accountCenterBasePath, handleAccountCenterRoute } from './utils/account-center-route';
import { getAccountTabSettings } from './utils/account-tabs';
import '@experience/shared/scss/normalized.scss';
import './scss/normalized.scss';

handleAccountCenterRoute();
void initI18n();

const ProfileEntry = () => {
  const { accountCenterSettings, experienceSettings } = useContext(PageContext);
  const { hasProfile, navItems } = getAccountTabSettings({
    accountCenterSettings,
    experienceSettings,
  });
  if (hasProfile) {
    return <Profile />;
  }
  const [firstAvailable] = navItems;
  return firstAvailable ? <Navigate replace to={firstAvailable.to} /> : <Home />;
};

const settingsUnavailable = (context: React.ContextType<typeof PageContext>) =>
  Boolean(context.experienceError) || !context.accountCenterSettings || !context.experienceSettings;

export const Main = () => {
  const params = new URLSearchParams(window.location.search);
  const { pathname } = window.location;
  const isAccountRoot =
    pathname === accountCenterBasePath || pathname === `${accountCenterBasePath}/`;
  const isSocialCallback = pathname.startsWith(
    `${accountCenterBasePath}${socialCallbackRoutePrefix}/`
  );
  const isAuthCallback = Boolean(params.get('code')) && isAccountRoot;
  const isErrorCallback = params.has('error') && isAccountRoot;
  const { isAuthenticated, isLoading } = useLogto();
  const context = useContext(PageContext);
  const {
    accountCenterSettings,
    experienceSettings,
    isLoadingExperience,
    isLoadingUserInfo,
    userInfo,
    reloadSettings,
  } = context;
  const isInitialAuthLoading = !isAuthenticated && isLoading;

  useAuthRedirect({ isInCallback: isSocialCallback || isAccountRoot });

  if (isSocialCallback) {
    return (
      <Routes>
        <Route path={`${socialCallbackRoutePrefix}/:connectorId`} element={<SocialCallback />} />
      </Routes>
    );
  }

  if (isAuthCallback) {
    return <Callback />;
  }

  if (isLoadingExperience) {
    return <GlobalLoading />;
  }

  if (settingsUnavailable(context)) {
    return (
      <ErrorPage
        titleKey="error.something_went_wrong"
        action={{
          titleKey: 'account_center.security.trusted_devices.retry',
          onClick: () => {
            void reloadSettings();
          },
        }}
      />
    );
  }

  if (!isAccountRoot && (isInitialAuthLoading || isLoadingUserInfo)) {
    return <GlobalLoading />;
  }

  // Account center is explicitly disabled - show error page for all routes
  if (accountCenterSettings?.enabled === false) {
    return (
      <Routes>
        <Route path="*" element={<Home />} />
      </Routes>
    );
  }

  // An error query is untrusted: show explicit recovery without clearing tokens,
  // accepting authentication, or overwriting the stored restoration target.
  if (isErrorCallback) {
    return <CallbackError />;
  }

  const {
    hasSecurity,
    hasSessions,
    navItems: accountNavItems,
  } = getAccountTabSettings({
    accountCenterSettings,
    experienceSettings,
  });

  if (isAccountRoot) {
    const [firstAvailableNavItem] = accountNavItems;

    if (!firstAvailableNavItem) {
      return (
        <Routes>
          <Route path="*" element={<Home />} />
        </Routes>
      );
    }

    return <Navigate replace to={firstAvailableNavItem.to} />;
  }

  if (!userInfo) {
    return <GlobalLoading />;
  }

  return (
    <Routes>
      <Route
        path={emailSuccessRoute}
        element={<UpdateSuccess identifierType={SignInIdentifier.Email} />}
      />
      <Route
        path={phoneSuccessRoute}
        element={<UpdateSuccess identifierType={SignInIdentifier.Phone} />}
      />
      <Route
        path={usernameSuccessRoute}
        element={<UpdateSuccess identifierType={SignInIdentifier.Username} />}
      />
      <Route path={passwordSuccessRoute} element={<UpdateSuccess identifierType="password" />} />
      <Route
        path={authenticatorAppSuccessRoute}
        element={<UpdateSuccess identifierType="totp" />}
      />
      <Route
        path={authenticatorAppReplaceSuccessRoute}
        element={<UpdateSuccess identifierType="totp_replaced" />}
      />
      <Route
        path={backupCodesSuccessRoute}
        element={<UpdateSuccess identifierType="backup_code" />}
      />
      <Route path={passkeySuccessRoute} element={<UpdateSuccess identifierType="passkey" />} />
      <Route path={socialSuccessRoute} element={<UpdateSuccess identifierType="social" />} />
      <Route path={emailRoute} element={<Email />} />
      <Route path={phoneRoute} element={<Phone />} />
      <Route path={passwordRoute} element={<Password />} />
      <Route path={usernameRoute} element={<Username />} />
      <Route path={authenticatorAppReplaceRoute} element={<TotpBinding isReplace />} />
      <Route path={authenticatorAppRoute} element={<TotpBinding />} />
      <Route path={backupCodesGenerateRoute} element={<BackupCodeBinding />} />
      <Route path={backupCodesRegenerateRoute} element={<BackupCodeBinding isRegenerate />} />
      <Route path={backupCodesManageRoute} element={<BackupCodeView />} />
      <Route path={passkeyAddRoute} element={<PasskeyBinding />} />
      <Route path={passkeyManageRoute} element={<PasskeyView />} />
      <Route path={verifiedActionRoute} element={<VerifiedAction />} />
      <Route path={`${socialRoutePrefix}/:connectorId`} element={<SocialFlow mode="add" />} />
      <Route
        path={`${socialRoutePrefix}/:connectorId/change`}
        element={<SocialFlow mode="change" />}
      />
      <Route
        path={`${socialRoutePrefix}/:connectorId/remove`}
        element={<SocialFlow mode="remove" />}
      />
      {hasSecurity && <Route path={securityRoute} element={<Security />} />}
      {hasSessions && <Route path={sessionsRoute} element={<Sessions />} />}
      <Route path={profileRoute} element={<ProfileEntry />} />
      <Route index element={<Home />} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
};

const App = () => (
  <BrowserRouter basename={accountCenterBasePath}>
    <LogtoProvider
      config={{
        endpoint: window.location.origin,
        appId: accountCenterApplicationId,
        includeReservedScopes: false,
        scopes: [
          ReservedScope.OpenId,
          UserScope.Profile,
          UserScope.Email,
          UserScope.Phone,
          UserScope.Address,
          UserScope.Identities,
          UserScope.CustomData,
          UserScope.Sessions,
          UserScope.TrustedDevices,
        ],
      }}
    >
      <LoadingContextProvider>
        <PageContextProvider>
          <AppBoundary>
            <AccountLayout>
              <Main />
            </AccountLayout>
          </AppBoundary>
        </PageContextProvider>
      </LoadingContextProvider>
    </LogtoProvider>
  </BrowserRouter>
);

export default App;

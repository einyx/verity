import { UserScope } from '@logto/core-kit';
import { LogtoProvider, Prompt, useLogto } from '@logto/react';
import {
  adminConsoleApplicationId,
  adminTenantId,
  defaultTenantId,
  ossConsolePath,
  PredefinedScope,
  TenantScope,
} from '@logto/schemas';
import { conditionalArray } from '@silverhand/essentials';
import { useContext, useMemo } from 'react';
import { Helmet } from 'react-helmet';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';

import 'overlayscrollbars/overlayscrollbars.css';
import './scss/normalized.scss';
import './scss/overlayscrollbars.scss';
// eslint-disable-next-line import/no-unassigned-import
import '@fontsource/roboto-mono';
// eslint-disable-next-line import/no-unassigned-import
import 'react-color-palette/css';

import 'react-day-picker/dist/style.css';

import CloudAppRoutes from '@/cloud/AppRoutes';
import AppLoading from '@/components/AppLoading';
import { isCloud } from '@/consts/env';
import { cloudApi, getManagementApi, meApi } from '@/consts/resources';
import { ConsoleRoutes } from '@/containers/ConsoleRoutes';

import { GlobalScripts } from './components/Conversion';
import { adminTenantEndpoint, mainTitle } from './consts';
import ErrorBoundary from './containers/ErrorBoundary';
import LogtoErrorBoundary from './containers/LogtoErrorBoundary';
import AppConfirmModalProvider from './contexts/AppConfirmModalProvider';
import AppDataProvider, { AppDataContext } from './contexts/AppDataProvider';
import { AppThemeProvider } from './contexts/AppThemeProvider';
import TenantsProvider, { TenantsContext } from './contexts/TenantsProvider';
import Toast from './ds-components/Toast';
import useCurrentUser from './hooks/use-current-user';
import { useNarrowViewport } from './hooks/use-narrow-viewport';
import initI18n from './i18n/init';

void initI18n();

/**
 * The main entry of the project. It provides two fundamental context providers:
 *
 * - `RouterProvider`: the sole router provider of the project.
 * - `TenantsProvider`: manages the tenants data, requires the `RouterProvider` to
 * get the current tenant ID from the URL.
 */
function App() {
  // The console is opened on phones as well. The narrow viewport has to be known before the content
  // is laid out, because the desktop minimum width would otherwise expand the layout viewport and
  // leave the page wider than the device.
  useNarrowViewport();

  const router = createBrowserRouter(
    [
      // Cloud has no tenant in the root path: open the default tenant instead of reading the path as one.
      ...(isCloud
        ? [
            { path: '/', element: <Navigate replace to={`/${defaultTenantId}`} /> },
            // Sign-in can return to `/console` under the base path, which is then matched as `/console/console`.
            { path: '/console', element: <Navigate replace to={`/${defaultTenantId}`} /> },
          ]
        : []),
      {
        path: '*',
        element: (
          <TenantsProvider>
            <Providers />
          </TenantsProvider>
        ),
      },
    ],
    // Local cloud dev serves the console under `/console` from core, so that prefix is the basename.
    // Otherwise the first path segment would be read as a tenant ID.
    { basename: isCloud ? ossConsolePath : undefined }
  );

  return <RouterProvider router={router} />;
}

export default App;

/**
 * This component serves as a container for all the providers and boundary components.
 *
 * Since `TenantsContext` requires the `TenantsProvider` to be mounted, and the initialization
 * of `LogtoProvider` requires the `TenantsContext` to be available, we have to put them into
 * different components.
 */
function Providers() {
  // For Cloud, we use Management API proxy for accessing tenant data.
  // For OSS, we directly call the tenant API with the default tenant API resource.
  const resources = useMemo(
    () =>
      isCloud
        ? [cloudApi.indicator, meApi.indicator, getManagementApi(adminTenantId).indicator]
        : [getManagementApi(defaultTenantId).indicator, meApi.indicator],
    []
  );

  const scopes = useMemo(
    () => [
      UserScope.Profile,
      UserScope.Email,
      UserScope.Phone,
      UserScope.Identities,
      UserScope.CustomData,
      UserScope.Organizations,
      UserScope.OrganizationRoles,
      PredefinedScope.All,
      ...conditionalArray(
        isCloud && [
          ...Object.values(TenantScope),
          cloudApi.scopes.CreateTenant,
          cloudApi.scopes.ManageTenantSelf,
          cloudApi.scopes.ManageAccountSelf,
        ]
      ),
      // Request the CMS scope so authorized operators can re-consent even when dev features are off.
      ...conditionalArray(isCloud && [cloudApi.scopes.ManageLandingPage]),
    ],
    []
  );

  return (
    <LogtoProvider
      unstable_enableCache
      config={{
        endpoint: adminTenantEndpoint.href,
        appId: adminConsoleApplicationId,
        resources,
        scopes,
        prompt: [Prompt.Login, Prompt.Consent],
      }}
    >
      <AppThemeProvider>
        <Helmet titleTemplate={`%s - ${mainTitle}`} defaultTitle={mainTitle} />
        <Toast />
        <AppConfirmModalProvider>
          <ErrorBoundary>
            <LogtoErrorBoundary>
              <AppDataProvider>
                <GlobalScripts />
                <Content />
              </AppDataProvider>
            </LogtoErrorBoundary>
          </ErrorBoundary>
        </AppConfirmModalProvider>
      </AppThemeProvider>
    </LogtoProvider>
  );
}

function Content() {
  const { tenantEndpoint } = useContext(AppDataContext);
  const { isLoaded } = useCurrentUser();
  const { isAuthenticated } = useLogto();
  const { currentTenantId } = useContext(TenantsContext);

  /**
   * If it's not Cloud (OSS), render the tenant app container directly since only default tenant is available;
   * if it's Cloud, render the tenant app container only when a tenant ID is available (in a tenant context).
   */
  if (!isCloud || currentTenantId) {
    // Authenticated user should load onboarding data before rendering the app.
    // This looks weird and it can be refactored by merging the onboarding
    // routes with the console routes.
    if (!tenantEndpoint || (isCloud && isAuthenticated && !isLoaded)) {
      return <AppLoading />;
    }
    return <ConsoleRoutes />;
  }

  return <CloudAppRoutes />;
}

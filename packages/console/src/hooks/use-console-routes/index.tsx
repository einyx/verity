import { condArray, joinPath } from '@silverhand/essentials';
import { useMemo } from 'react';
import { Navigate, useParams, type RouteObject } from 'react-router-dom';
import { safeLazy } from 'react-safe-lazy';

import { isCloud, isDevFeaturesEnabled } from '@/consts/env';
import useIsActionsEnabled from '@/hooks/use-is-actions-enabled';
import NotFound from '@/pages/NotFound';

import { actions } from './routes/actions';
import { apiResources } from './routes/api-resources';
import { applications } from './routes/applications';
import { auditLogs } from './routes/audit-logs';
import { connectors } from './routes/connectors';
import { customizeJwt } from './routes/customize-jwt';
import { enterpriseSso } from './routes/enterprise-sso';
import { kubo } from './routes/kubo';
import { landingPage } from './routes/landing-page';
import { leads } from './routes/leads';
import { mcpPortal, mcpPortalDetails } from './routes/mcp-portal';
import { mfa } from './routes/mfa';
import { organizationTemplate } from './routes/organization-template';
import { organizations } from './routes/organizations';
import { roles } from './routes/roles';
import { security } from './routes/security';
import { signInExperience } from './routes/sign-in-experience';
import { tenantAccess } from './routes/tenant-access';
import { useTenantSettings } from './routes/tenant-settings';
import { users } from './routes/users';
import { webhooks } from './routes/webhooks';

const Dashboard = safeLazy(async () => import('@/pages/Dashboard'));
const GetStarted = safeLazy(async () => import('@/pages/GetStarted'));

export const useConsoleRoutes = () => {
  const tenantSettings = useTenantSettings();
  const isActionsEnabled = useIsActionsEnabled();
  const { tenantId } = useParams();

  const routeObjects: RouteObject[] = useMemo(
    () =>
      condArray<RouteObject | RouteObject[]>(
        { path: '*', element: <NotFound /> },
        {
          path: 'get-started',
          element: (
            <Navigate
              replace
              to={tenantId ? joinPath(tenantId, 'infrastructure/new') : '/infrastructure/new'}
            />
          ),
        },
        { path: 'dashboard', element: <Dashboard /> },
        applications,
        apiResources,
        signInExperience,
        mfa,
        connectors,
        enterpriseSso,
        security,
        kubo,
        mcpPortal,
        mcpPortalDetails,
        webhooks,
        ...(isActionsEnabled ? [actions] : []),
        ...(isCloud ? [leads, tenantAccess] : []),
        // The landing page editor is an in-development feature, so it stays behind the dev flag.
        ...(isCloud && isDevFeaturesEnabled ? [landingPage] : []),
        users,
        auditLogs,
        roles,
        organizationTemplate,
        organizations,
        {
          path: 'signing-keys',
          // Deprecated page, redirect to oidc-configs in the tenant settings page.
          element: (
            <Navigate
              replace
              to={tenantId ? joinPath(tenantId, 'tenant-settings/oidc-configs') : '/'}
            />
          ),
        },
        tenantSettings,
        customizeJwt
      ),
    [isActionsEnabled, tenantId, tenantSettings]
  );

  return routeObjects;
};

import { useLogto } from '@logto/react';
import {
  adminTenantId,
  defaultManagementApiAdminName,
  defaultTenantId,
  getTenantIdFromOrganizationId,
} from '@logto/schemas';
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';

import AppLoading from '@/components/AppLoading';

/**
 * Opens the tenant the signed-in user belongs to, so they land somewhere they can use.
 *
 * The Console is the admin tenant's own Console, so a person who holds the Console access role
 * there belongs in it. Anyone else starts in the tenant of the organization they are a member of,
 * and the default tenant is the last fallback.
 */
function TenantLanding() {
  const { getIdTokenClaims, isAuthenticated, isLoading } = useLogto();
  const [tenantId, setTenantId] = useState<string>();

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    const load = async () => {
      const claims = await getIdTokenClaims();
      const roles = claims?.roles;

      if (Array.isArray(roles) && roles.includes(defaultManagementApiAdminName)) {
        setTenantId(adminTenantId);
        return;
      }

      const organizations = claims?.organizations;
      const first = Array.isArray(organizations) ? organizations[0] : undefined;

      if (typeof first === 'string') {
        try {
          setTenantId(getTenantIdFromOrganizationId(first));
          return;
        } catch {
          // An organization of another kind, which belongs to no tenant of this instance.
        }
      }

      setTenantId(defaultTenantId);
    };

    void load();
  }, [getIdTokenClaims, isAuthenticated]);

  if (tenantId) {
    return <Navigate replace to={`/${tenantId}`} />;
  }

  if (isLoading || isAuthenticated) {
    return <AppLoading />;
  }

  return <Navigate replace to={`/${defaultTenantId}`} />;
}

export default TenantLanding;

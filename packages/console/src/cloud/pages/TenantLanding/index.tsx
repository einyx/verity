import { useLogto } from '@logto/react';
import { defaultTenantId, getTenantIdFromOrganizationId } from '@logto/schemas';
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';

/**
 * Opens the tenant the signed-in user is a member of, so they land somewhere they can use.
 *
 * The Console has one page per tenant, and a user belongs to the tenant of every organization
 * they are a member of. The default tenant is only the fallback: a user who administers another
 * tenant would land on a page that answers that it cannot read it.
 */
function TenantLanding() {
  const { getIdTokenClaims } = useLogto();
  const [tenantId, setTenantId] = useState<string>();

  useEffect(() => {
    const load = async () => {
      const claims = await getIdTokenClaims();
      const organizations = claims?.organizations;
      const first = Array.isArray(organizations) ? organizations[0] : undefined;

      if (typeof first !== 'string') {
        return;
      }

      try {
        setTenantId(getTenantIdFromOrganizationId(first));
      } catch {
        // An organization of another kind, which belongs to no tenant of this instance.
      }
    };

    void load();
  }, [getIdTokenClaims]);

  return <Navigate replace to={`/${tenantId ?? defaultTenantId}`} />;
}

export default TenantLanding;

import { useLogto } from '@logto/react';
import { type ComponentProps, useContext, useEffect, useMemo, useState } from 'react';

import { isDevFeaturesEnabled } from '@/consts/env';
import { TenantsContext } from '@/contexts/TenantsProvider';
import useApi from '@/hooks/use-api';

import LegacyAiChat from './LegacyAiChat';
import PersistentAiChat from './PersistentAiChat';
import { createSessionApi } from './session-api';
import useLandingPageAiHeaders from './use-landing-page-ai-headers';

type Props = ComponentProps<typeof LegacyAiChat>;

function AccountAiChat(props: Props) {
  const { isAuthenticated, getIdTokenClaims } = useLogto();
  const { currentTenantId } = useContext(TenantsContext);
  const [principal, setPrincipal] = useState<string>();
  const api = useApi({ hideErrorToast: true });
  const landingHeaders = useLandingPageAiHeaders();
  const sessionApi = useMemo(() => createSessionApi(api, landingHeaders), [api, landingHeaders]);
  useEffect(() => {
    const lifetime = new AbortController();
    setPrincipal(undefined);
    // SDK methods (including this claims read and tenant token reads) toggle
    // isLoading. It is operation state, not an account identity boundary.
    if (isAuthenticated) {
      void (async () => {
        try {
          const claims = await getIdTokenClaims();
          if (!lifetime.signal.aborted) {
            setPrincipal(claims?.sub);
          }
        } catch {
          /* Remain locked until identity is known. */
        }
      })();
    }
    return () => {
      lifetime.abort();
    };
  }, [isAuthenticated, getIdTokenClaims]);
  const scope = useMemo(
    () =>
      isAuthenticated && principal && currentTenantId
        ? { tenantId: currentTenantId, userId: principal }
        : undefined,
    [isAuthenticated, principal, currentTenantId]
  );
  return <PersistentAiChat {...props} scope={scope} api={sessionApi} />;
}

export default function AiChat(props: Props) {
  return isDevFeaturesEnabled ? <AccountAiChat {...props} /> : <LegacyAiChat {...props} />;
}

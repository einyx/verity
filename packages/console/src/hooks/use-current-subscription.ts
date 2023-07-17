import { useContext } from 'react';
import useSWR from 'swr';

import { useCloudApi } from '@/cloud/hooks/use-cloud-api';
import { type Subscription } from '@/cloud/types/router';
import { isCloud } from '@/consts/env';
import { TenantsContext } from '@/contexts/TenantsProvider';

const useCurrentSubscription = () => {
  const { currentTenantId } = useContext(TenantsContext);
  const cloudApi = useCloudApi();
  return useSWR<Subscription, Error>(
    isCloud && `/api/tenants/${currentTenantId}/subscription`,
    async () =>
      cloudApi.get('/api/tenants/:tenantId/subscription', {
        params: { tenantId: currentTenantId },
      })
  );
};

export default useCurrentSubscription;

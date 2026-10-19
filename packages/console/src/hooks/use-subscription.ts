import { adminTenantId } from '@logto/schemas';
import useSWR from 'swr';

import { useCloudApi } from '@/cloud/hooks/use-cloud-api';
import { type Subscription } from '@/cloud/types/router';
import { isCloud } from '@/consts/env';

const useSubscription = (tenantId: string) => {
  const cloudApi = useCloudApi();
  return useSWR<Subscription, Error>(
    // `tenantId` could be an empty string which may cause the request to fail
    // The admin tenant is the instance's own console and has no subscription, so its request would only return 403.
    isCloud && tenantId && tenantId !== adminTenantId && `/api/tenants/${tenantId}/subscription`,
    async () =>
      cloudApi.get('/api/tenants/:tenantId/subscription', {
        params: { tenantId },
      })
  );
};

export default useSubscription;

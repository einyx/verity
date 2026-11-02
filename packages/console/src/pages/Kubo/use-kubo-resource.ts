import { nanoid } from 'nanoid';
import { createContext, useContext, useMemo } from 'react';
import useSWR, { type SWRConfiguration } from 'swr';

import useApi, { type RequestError } from '@/hooks/use-api';

export type KuboScope = 'tenant' | 'all';
export const KuboSessionContext = createContext<{
  identity?: string;
  tenantId: string;
}>({ tenantId: '' });

export const scopedKuboPath = (path: string, scope: KuboScope) =>
  `${path}${path.includes('?') ? '&' : '?'}scope=${scope}`;

/** Kubo alone opts out of global previous-data/fallback behavior. Never key by URL alone. */
export default function useKuboResource<T>(
  path: string | undefined,
  scope: KuboScope = 'tenant',
  options?: SWRConfiguration<T, RequestError>
) {
  const api = useApi();
  const { identity, tenantId } = useContext(KuboSessionContext);
  const url = path ? scopedKuboPath(path, scope) : undefined;
  // A resumed view must rediscover capabilities/ownership, not revive an old positive.
  // The epoch is local to Kubo; it does not change the console's global SWR cache policy.
  const context = useMemo(
    () => ({ identity, tenantId, scope, url, epoch: nanoid() }),
    [identity, tenantId, scope, url]
  );
  return useSWR<T, RequestError>(
    identity && tenantId && url ? ['kubo', identity, tenantId, scope, url, context.epoch] : null,
    async () => api.get(url ?? '').json<T>(),
    {
      ...options,
      keepPreviousData: false,
      fallbackData: undefined,
      fallback: {},
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
    }
  );
}

import useSWR from 'swr';

import { type RequestError } from '@/hooks/use-api';

import { portalsKey } from './types';

type HostingStatus = { status: 'ready' | 'pending' | 'unmanaged' };

/** A saved portal is not ready until its public DNS, certificate and discovery route all work. */
function PortalHosting({ portalId }: { readonly portalId: string }) {
  const { data, error } = useSWR<HostingStatus, RequestError>(
    `${portalsKey}/${encodeURIComponent(portalId)}/hosting`,
    { refreshInterval: (value) => (value?.status === 'ready' ? 0 : 15_000) }
  );

  if (error) {
    return <span role="status">HTTPS check unavailable</span>;
  }

  return (
    <span role="status">
      {data?.status === 'ready'
        ? 'Ready'
        : data?.status === 'unmanaged'
          ? 'Custom hosting'
          : 'Checking HTTPS…'}
    </span>
  );
}

export default PortalHosting;

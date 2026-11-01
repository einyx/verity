import { useLogto } from '@logto/react';
import { useCallback } from 'react';

import { isCloud } from '@/consts/env';
import { cloudApi } from '@/consts/resources';

/** The editor needs a Cloud token; ordinary Ask AI tools still use the tenant token. */
const useLandingPageAiHeaders = () => {
  const { getAccessToken } = useLogto();

  return useCallback(async (): Promise<Record<string, string>> => {
    if (!isCloud) {
      return {};
    }

    try {
      const token = await getAccessToken(cloudApi.indicator);
      return token ? { 'x-landing-page-authorization': `Bearer ${token}` } : {};
    } catch {
      // An unavailable editor credential must not prevent unrelated tenant tools from working.
      return {};
    }
  }, [getAccessToken]);
};

export default useLandingPageAiHeaders;

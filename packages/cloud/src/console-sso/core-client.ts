import { z } from 'zod';

import { type CoreConnectorPayload, type CoreSsoClient } from './core-binding.js';

const createdConnectorGuard = z.object({ id: z.string() });

export type CoreSsoClientOptions = {
  /** The admin tenant's Management API base, e.g. `https://console.example.com/api`. */
  baseUrl: string;
  /** Returns a Management API access token for the cloud service. */
  getAccessToken: () => Promise<string>;
  fetch?: typeof fetch;
};

/**
 * Calls core's Enterprise SSO routes (`/sso-connectors`) with the cloud service's Management API
 * token. A failed response throws with core's status, so the caller does not store a half-made
 * binding.
 */
export const createCoreSsoClient = (options: CoreSsoClientOptions): CoreSsoClient => {
  const doFetch = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/$/, '');

  const request = async (path: string, init: { method: string; body: unknown }) => {
    const response = await doFetch(`${base}${path}`, {
      method: init.method,
      headers: {
        authorization: `Bearer ${await options.getAccessToken()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(init.body),
    });

    if (!response.ok) {
      throw new Error(`Core SSO request failed with ${response.status}`);
    }

    const body: unknown = await response.json();

    return body;
  };

  return {
    async createConnector(payload: CoreConnectorPayload) {
      const body = await request('/sso-connectors', { method: 'POST', body: payload });
      const parsed = createdConnectorGuard.safeParse(body);

      if (!parsed.success) {
        throw new TypeError('Core SSO response did not include a connector ID');
      }

      return { id: parsed.data.id };
    },
    async updateConnectorDomains(connectorId, domains) {
      await request(`/sso-connectors/${encodeURIComponent(connectorId)}`, {
        method: 'PATCH',
        body: { domains },
      });
    },
  };
};

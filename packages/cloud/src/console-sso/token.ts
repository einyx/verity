import { z } from 'zod';

export type ClientCredentialsOptions = {
  /** The OAuth token endpoint of the tenant that issues the Management API token. */
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  /** The Management API resource indicator, e.g. `https://console.example.com/api`. */
  resource: string;
  fetch?: typeof fetch;
};

const tokenGuard = z.object({
  access_token: z.string(),
  expires_in: z.number(),
});

/**
 * Fetches a Management API token with the client-credentials grant and reuses it until shortly
 * before it expires. The secret stays in memory and is never logged.
 */
export const createClientCredentialsToken = (options: ClientCredentialsOptions) => {
  const doFetch = options.fetch ?? fetch;
  // Refresh a minute early so a token never expires between fetching and use.
  const refreshMarginMs = 60_000;
  // A cached token is the one piece of state this client keeps; it is replaced, never mutated.
  // eslint-disable-next-line @silverhand/fp/no-let -- Token cache: the single intentional piece of state.
  let cached: { token: string; expiresAt: number } | undefined;

  const fetchToken = async () => {
    const response = await doFetch(options.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: options.clientId,
        client_secret: options.clientSecret,
        resource: options.resource,
      }),
    });

    if (!response.ok) {
      throw new Error(`Token request failed with ${response.status}`);
    }

    const parsed = tokenGuard.safeParse(await response.json());

    if (!parsed.success) {
      throw new Error('Token response has an unexpected shape');
    }

    return {
      token: parsed.data.access_token,
      expiresAt: Date.now() + parsed.data.expires_in * 1000 - refreshMarginMs,
    };
  };

  return async (): Promise<string> => {
    if (!cached || cached.expiresAt <= Date.now()) {
      // eslint-disable-next-line @silverhand/fp/no-mutation -- Replaces the cached token; see the cache above.
      cached = await fetchToken();
    }

    return cached.token;
  };
};

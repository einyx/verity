import {
  decryptCredential,
  encryptCredential,
  isAccessTokenFresh,
  parseCredential,
  parseCredentialKey,
  refreshTokens,
  serializeOAuthRecord,
  TokenRequestError,
  type OAuthRecord,
  type Upstream,
  type UpstreamStore,
} from '@logto/mcp-portal';

/** The deployment's key, read on each use so a restart with a new key takes effect at once. */
export const credentialKey = () => parseCredentialKey(process.env.MCP_PORTAL_ENCRYPTION_KEY);

/**
 * The upstream's stored sign-in can no longer be used: it has no refresh token, or the authorization
 * server rejected the refresh. Retrying will not help; the admin has to sign in to the upstream again.
 */
export class ReauthRequiredError extends Error {
  constructor(readonly upstreamName: string) {
    super(`Upstream "${upstreamName}" must be signed in again.`);
    this.name = 'ReauthRequiredError';
  }
}

/**
 * Refreshes in progress, keyed by upstream. Refresh tokens can rotate, so two refreshes at once can
 * invalidate each other; concurrent callers share the first one. This is per process: several core
 * replicas would still need a database lock.
 */
const refreshesInProgress = new Map<string, Promise<string>>();

const requestRefresh = async (
  upstream: Upstream,
  credential: OAuthRecord & { refreshToken: string }
) => {
  try {
    return await refreshTokens(
      {
        issuer: credential.tokenEndpoint,
        authorization_endpoint: credential.authorizationEndpoint,
        token_endpoint: credential.tokenEndpoint,
      },
      {
        clientId: credential.clientId,
        refreshToken: credential.refreshToken,
        resource: credential.resource,
      }
    );
  } catch (error: unknown) {
    if (error instanceof TokenRequestError && error.isRejected) {
      throw new ReauthRequiredError(upstream.name);
    }

    throw error;
  }
};

const refreshAccessToken = async (
  upstreams: UpstreamStore,
  upstream: Upstream,
  credential: OAuthRecord & { refreshToken: string }
): Promise<string> => {
  const tokens = await requestRefresh(upstream, credential);

  const refreshed: OAuthRecord = {
    ...credential,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? credential.refreshToken,
    expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
  };
  await upstreams.setCredential(
    upstream.portalId,
    upstream.name,
    encryptCredential(serializeOAuthRecord(refreshed), credentialKey())
  );

  return tokens.access_token;
};

/**
 * Decrypts an upstream's stored token just before the endpoint connects to it. Returns undefined when
 * the server has no token. Throws `CredentialKeyError` when a token exists but the key is missing, and
 * `ReauthRequiredError` when the admin has to sign in to the upstream again.
 */
export const unlockFor = (upstreams: UpstreamStore) => async (upstream: Upstream) => {
  const stored = await upstreams.findCredential(upstream.portalId, upstream.name);

  if (stored === undefined) {
    return;
  }

  const credential = parseCredential(decryptCredential(stored, credentialKey()));

  if (credential.kind === 'bearer') {
    return credential.token;
  }

  if (isAccessTokenFresh(credential)) {
    return credential.accessToken;
  }

  if (!credential.refreshToken) {
    throw new ReauthRequiredError(upstream.name);
  }

  const key = `${upstream.portalId}/${upstream.name}`;
  const inProgress = refreshesInProgress.get(key);

  if (inProgress) {
    return inProgress;
  }

  const { refreshToken } = credential;
  const refresh = (async () => {
    try {
      return await refreshAccessToken(upstreams, upstream, { ...credential, refreshToken });
    } finally {
      refreshesInProgress.delete(key);
    }
  })();
  refreshesInProgress.set(key, refresh);

  return refresh;
};

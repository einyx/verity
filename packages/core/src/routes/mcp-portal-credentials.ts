import {
  decryptCredential,
  encryptCredential,
  isAccessTokenFresh,
  parseCredential,
  parseCredentialKey,
  refreshTokens,
  serializeOAuthRecord,
  type OAuthRecord,
  type Upstream,
  type UpstreamStore,
} from '@logto/mcp-portal';

/** The deployment's key, read on each use so a restart with a new key takes effect at once. */
export const credentialKey = () => parseCredentialKey(process.env.MCP_PORTAL_ENCRYPTION_KEY);

/**
 * Decrypts an upstream's stored token just before the endpoint connects to it. Returns undefined when
 * the server has no token. Throws `CredentialKeyError` when a token exists but the key is missing.
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
    // Without a refresh token the admin has to authorise again; the connection fails until then.
    return;
  }

  const tokens = await refreshTokens(
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

  return refreshed.accessToken;
};

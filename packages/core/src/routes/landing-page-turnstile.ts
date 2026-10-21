// Cloudflare Turnstile check for the public landing-page chat. A new chat session must carry a token
// that Cloudflare confirms, so scripts cannot open sessions in bulk and use up the daily session cap.
// The secret stays on the server. Any failure, including a missing secret or an unreachable Cloudflare,
// counts as a failed check.

export const turnstileSiteverifyUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** How long to wait for Cloudflare before refusing the session. */
const verifyTimeoutMs = 5000;

/**
 * Confirms a Turnstile token with Cloudflare. Returns false when the token is missing, when Cloudflare
 * rejects it, when the secret is not configured, or when the request fails for any reason.
 */
export const verifyTurnstileToken = async (
  secret: string | undefined,
  token: string | undefined,
  remoteIp: string
): Promise<boolean> => {
  if (!secret || !token) {
    return false;
  }

  try {
    const response = await fetch(turnstileSiteverifyUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(verifyTimeoutMs),
      body: new URLSearchParams({ secret, response: token, remoteip: remoteIp }),
    });

    if (!response.ok) {
      return false;
    }

    const data: unknown = await response.json();

    return typeof data === 'object' && data !== null && 'success' in data && data.success === true;
  } catch {
    // The error text can echo request details, so it is not logged. A failed check only refuses the session.
    return false;
  }
};

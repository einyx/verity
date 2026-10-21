import { createHmac, timingSafeEqual } from 'node:crypto';

// Signed, time-limited links to a lead's meeting brief and slides, for the Slack message. A Slack link
// cannot carry the admin token, so the link carries a signature instead: HMAC over the file kind, the
// session and an expiry time. Without the secret nothing can be forged, and a link stops working after it
// expires.

export type LeadFileKind = 'brief' | 'slides';

const linkLifetimeSeconds = 7 * 24 * 60 * 60;

const signature = (secret: string, kind: LeadFileKind, sessionId: string, expires: number) =>
  createHmac('sha256', secret).update(`${kind}:${sessionId}:${expires}`).digest('base64url');

/** A signed query string for one lead file, valid for seven days. */
export const signLeadFileQuery = (
  secret: string,
  kind: LeadFileKind,
  sessionId: string,
  now: number = Date.now()
): string => {
  const expires = Math.floor(now / 1000) + linkLifetimeSeconds;

  return `expires=${expires}&sig=${signature(secret, kind, sessionId, expires)}`;
};

/** True only when the signature matches and the link has not expired. */
export const verifyLeadFileQuery = (
  secret: string,
  kind: LeadFileKind,
  sessionId: string,
  query: { expires?: string; sig?: string },
  now: number = Date.now()
): boolean => {
  const expires = Number(query.expires);

  if (!Number.isInteger(expires) || expires < Math.floor(now / 1000) || !query.sig) {
    return false;
  }

  const expected = Buffer.from(signature(secret, kind, sessionId, expires));
  const given = Buffer.from(query.sig);

  return expected.length === given.length && timingSafeEqual(expected, given);
};

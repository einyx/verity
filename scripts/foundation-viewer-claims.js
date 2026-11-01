const isAllowedAudience = (audience) => {
  if (typeof audience !== 'string' || !audience) return false;
  try {
    const parsed = new URL(audience);
    return parsed.protocol === 'https:' && parsed.hostname === 'demo.meshx.foundation';
  } catch {
    return false;
  }
};

const getCustomJwtClaims = ({ token, context }) => {
  const audiences = Array.isArray(token.aud) ? token.aud : [token.aud];
  const user = context?.user;
  if (
    token.kind !== 'AccessToken' ||
    !audiences.some(isAllowedAudience) ||
    !user?.id || token.accountId !== user.id || user.isSuspended ||
    typeof user.primaryEmail !== 'string' || !user.primaryEmail
  ) return {};

  // Match Logto's own email_verified semantics; never trust customData or client input.
  return { email: user.primaryEmail, email_verified: true };
};

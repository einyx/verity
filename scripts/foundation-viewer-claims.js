// OAuth audiences are exact identifiers, not any URL on an allowed host. Avoid relying on
// URL globals as the custom-claims sandbox may not provide them.
const isAllowedAudience = (audience) => audience === 'https://demo.meshx.foundation/';

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

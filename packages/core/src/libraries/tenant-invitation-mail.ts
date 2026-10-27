import { generateStandardId, generateStandardSecret } from '@logto/shared';

import type Queries from '#src/tenants/Queries.js';


// The sign-in link of a tenant invitation. The mail itself is in onboarding-email.ts.

export type TenantInvitationLink = {
  /** The Console accept link, which signs the invitee in with a fresh one-time token. */
  link: string;
  oneTimeTokenId: string;
  /** Whether the invitee already has an account, which changes what the mail tells them to do. */
  hasAccount: boolean;
};

/**
 * Builds the Console accept link for an invitation. The link carries a one-time token bound to the
 * invitee's email, so it signs that one person in and nothing else.
 */
export const buildInvitationLink = async (options: {
  queries: Pick<Queries, 'oneTimeTokens' | 'users'>;
  invitationId: string;
  invitee: string;
  expiresAt: number;
  consoleEndpoint: URL;
  consolePath: string;
}): Promise<TenantInvitationLink> => {
  const { queries, invitationId, invitee, expiresAt, consoleEndpoint, consolePath } = options;

  // Invitees are stored lowercased, while an existing account keeps its email as entered. Issue
  // the token for the account's own spelling, which the sign-in compares it with verbatim.
  const existingUser = await queries.users.findUserByEmail(invitee);
  const email = existingUser?.primaryEmail ?? invitee;
  const oneTimeToken = await queries.oneTimeTokens.insertOneTimeToken({
    id: generateStandardId(),
    email,
    token: generateStandardSecret(),
    expiresAt,
  });
  const link = new URL(`${consolePath}/accept/${invitationId}`, consoleEndpoint);
  link.searchParams.set('one_time_token', oneTimeToken.token);
  link.searchParams.set('email', email);

  return { link: link.href, oneTimeTokenId: oneTimeToken.id, hasAccount: Boolean(existingUser) };
};

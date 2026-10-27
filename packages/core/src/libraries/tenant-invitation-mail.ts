import { generateStandardId, generateStandardSecret } from '@logto/shared';

import type Queries from '#src/tenants/Queries.js';

import { readAcsMailConfig, sendMail, toSingleLine } from './acs-mail.js';
// The onboarding mail of a tenant invitation. The platform sends it with its own mail service, so
// every tenant can invite people whether or not it has an email connector of its own.

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

/** The plain-text body the platform sends when it sends the invitation itself. */
export const buildInvitationBody = (options: {
  organizationName: string;
  inviterName?: string | null;
  firstName?: string | null;
  link: string;
  expiresAt: number;
  hasAccount: boolean;
}): string => {
  const { organizationName, inviterName, firstName, link, expiresAt, hasAccount } = options;
  const inviter = toSingleLine(inviterName) || 'Someone';
  const greeting = toSingleLine(firstName) ? `Hi ${toSingleLine(firstName)},` : 'Hi,';
  const until = new Date(expiresAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return [
    greeting,
    '',
    `${inviter} invited you to ${toSingleLine(organizationName)}.`,
    '',
    `Use this link to get in: ${toSingleLine(link)}`,
    hasAccount
      ? 'The link signs you in and accepts the invitation.'
      : 'The link takes you through creating your account and setting a password, then accepts the invitation.',
    `The link works until ${until}.`,
    '',
    '— meshX',
  ].join('\n');
};

/**
 * Sends the invitation through the platform's own mail service. Returns false when the platform
 * has no mail service configured, so the caller can send the mail another way.
 */
export const sendInvitationMail = async (options: {
  to: string;
  organizationName: string;
  inviterName?: string | null;
  inviterEmail?: string | null;
  firstName?: string | null;
  link: string;
  expiresAt: number;
  hasAccount: boolean;
}): Promise<boolean> => {
  const config = readAcsMailConfig();

  if (!config) {
    return false;
  }

  const { to, organizationName, inviterName, inviterEmail, firstName, link, expiresAt, hasAccount } =
    options;

  await sendMail(
    {
      to,
      subject: `You have been invited to ${toSingleLine(organizationName)}`,
      text: buildInvitationBody({
        organizationName,
        inviterName,
        firstName,
        link,
        expiresAt,
        hasAccount,
      }),
      ...(inviterEmail ? { replyTo: inviterEmail } : {}),
    },
    config
  );

  return true;
};

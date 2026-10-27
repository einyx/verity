import { generateStandardId, generateStandardSecret } from '@logto/shared';
import { TemplateType, replaceSendMessageHandlebars } from '@logto/connector-kit';

import type Queries from '#src/tenants/Queries.js';

import { readAcsMailConfig, sendMail, toSingleLine } from './acs-mail.js';

// The onboarding mail of a tenant invitation.
//
// The mail goes out through the tenant's own email connector, the same one that sends the sign-in
// codes, so it carries the same templates, sender and branding as every other mail. A tenant
// without a connector falls back to the platform's own mail service.

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

/** The template the platform sends when the tenant has no email connector of its own. */
export const defaultInvitationTemplate = Object.freeze({
  subject: 'You have been invited to join {{organization.name}}',
  content: [
    'Hi {{firstName}},',
    '',
    '{{inviter.name}} invited you to join {{organization.name}}.',
    '',
    'Use this link to get in: {{link}}',
    '',
    'Set your password in your profile once you are in. The link works until {{expiresAt}}.',
    '',
    '— meshX',
  ].join('\n'),
});

/** The values the invitation template is rendered with. */
export type InvitationMailPayload = {
  organization: { id: string; name: string };
  inviter: { id: string; name: string };
  firstName: string;
  link: string;
  expiresAt: string;
};

/**
 * Sends the invitation through the platform's own mail service. Returns false when the platform
 * has no mail service configured, so the caller can send the mail through the tenant's connector.
 */
export const sendInvitationMailWithPlatformService = async (options: {
  to: string;
  payload: InvitationMailPayload;
  replyTo?: string | null;
}): Promise<boolean> => {
  const config = readAcsMailConfig();

  if (!config) {
    return false;
  }

  const { to, payload, replyTo } = options;

  await sendMail(
    {
      to,
      subject: replaceSendMessageHandlebars(defaultInvitationTemplate.subject, payload),
      text: replaceSendMessageHandlebars(defaultInvitationTemplate.content, payload),
      ...(replyTo ? { replyTo: toSingleLine(replyTo) } : {}),
    },
    config
  );

  return true;
};

/** The usage type the invitation mail is sent under, so the connector picks its own template. */
export const invitationTemplateType = TemplateType.OrganizationInvitation;

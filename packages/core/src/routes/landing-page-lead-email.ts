import { type DemoLead } from './landing-page-chat-guard.js';

import { sendMail, toSingleLine, type AcsMailConfig } from '../libraries/acs-mail.js';

// Sends a demo lead through Azure Communication Services (ACS) Email. Recipients are configured by
// the operator, never by model output or visitor input.

/** Parses the operator-configured comma-separated recipient list without choosing a default inbox. */
export const parseLeadRecipients = (value?: string): string[] =>
  (value ?? '')
    .split(',')
    .map((address) => toSingleLine(address))
    .filter(Boolean);

const contactLabels: Record<NonNullable<DemoLead['contactMethod']>, string> = {
  email: 'Email',
  whatsapp: 'WhatsApp',
  phone: 'Phone call',
  linkedin: 'LinkedIn',
};

/** The plain-text body for one lead. Only the validated lead fields are included. */
export const buildLeadBody = (lead: DemoLead): string =>
  [
    'A new demo request came in through the meshX landing page chat.',
    '',
    `Name: ${toSingleLine(`${lead.firstName} ${lead.lastName}`)}`,
    `Email: ${toSingleLine(lead.email)}`,
    ...(lead.company ? [`Company: ${toSingleLine(lead.company)}`] : []),
    `Role: ${toSingleLine(lead.role)}`,
    `Industry: ${toSingleLine(lead.industry)}`,
    `Interests: ${toSingleLine((lead.interests ?? []).join(', '))}`,
    `Decision: ${toSingleLine(lead.decision)}`,
    `Preferred contact: ${toSingleLine(contactLabels[lead.contactMethod ?? 'email'])}`,
    `Contact detail: ${toSingleLine(lead.contactDetail ?? lead.email)}`,
    '',
    'The visitor agreed to be contacted.',
  ].join('\n');

/** Sends one lead. Throws when ACS does not accept the message, so the caller can tell the visitor. */
export const sendLeadEmail = async (
  lead: DemoLead,
  config: AcsMailConfig & { recipients: readonly string[] },
  send: typeof fetch = fetch,
  now: () => Date = () => new Date()
): Promise<void> => {
  if (config.recipients.length === 0) {
    throw new Error('Lead delivery recipients are not configured.');
  }

  await sendMail(
    {
      to: config.recipients,
      subject: 'New demo request from the meshX landing page',
      text: buildLeadBody(lead),
      replyTo: lead.email,
    },
    config,
    send,
    now
  );
};

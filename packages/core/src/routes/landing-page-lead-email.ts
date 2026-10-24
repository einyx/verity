import { createHash, createHmac } from 'node:crypto';

import { type DemoLead } from './landing-page-chat-guard.js';

// Sends a demo lead through Azure Communication Services (ACS) Email. Recipients are configured by
// the operator, never by model output or visitor input. Every field is plain text, and line breaks
// are removed so nothing can add a header or a second message to the email.

/** Parses the operator-configured comma-separated recipient list without choosing a default inbox. */
export const parseLeadRecipients = (value?: string): string[] =>
  (value ?? '')
    .split(',')
    .map((address) => toSingleLine(address))
    .filter(Boolean);

const apiVersion = '2023-03-31';

type AcsConfig = {
  endpoint: URL;
  accessKey: Uint8Array;
  sender: string;
  recipients: readonly string[];
};

/** Reads `endpoint=...;accesskey=...` from an ACS connection string. Returns undefined when malformed. */
export const parseAcsConnectionString = (
  value: string
): { endpoint: URL; accessKey: Uint8Array } | undefined => {
  const parts = new Map(
    value
      .split(';')
      .map((part): [string, string] | undefined => {
        const index = part.indexOf('=');

        return index > 0
          ? [part.slice(0, index).trim().toLowerCase(), part.slice(index + 1).trim()]
          : undefined;
      })
      .filter((entry): entry is [string, string] => entry !== undefined)
  );
  const endpoint = parts.get('endpoint');
  const key = parts.get('accesskey');

  if (!endpoint || !key) {
    return undefined;
  }

  try {
    return { endpoint: new URL(endpoint), accessKey: Buffer.from(key, 'base64') };
  } catch {
    return undefined;
  }
};

/** Removes line breaks and collapses spaces, so a value stays on one line of the email. */
export const toSingleLine = (value?: string): string =>
  (value ?? '')
    .replaceAll(/[\t\n\r]+/g, ' ')
    .replaceAll(/ {2,}/g, ' ')
    .trim();

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
    `Company: ${toSingleLine(lead.company)}`,
    `Role: ${toSingleLine(lead.role)}`,
    `Industry: ${toSingleLine(lead.industry)}`,
    `Interests: ${toSingleLine((lead.interests ?? []).join(', '))}`,
    `Decision: ${toSingleLine(lead.decision)}`,
    `Preferred contact: ${toSingleLine(contactLabels[lead.contactMethod ?? 'email'])}`,
    `Contact detail: ${toSingleLine(lead.contactDetail ?? lead.email)}`,
    '',
    'The visitor agreed to be contacted.',
  ].join('\n');

/** The HMAC-SHA256 authorization that ACS requires for a request. */
const signAcsRequest = (options: {
  method: string;
  url: URL;
  body: string;
  date: string;
  accessKey: Uint8Array;
}): { authorization: string; contentHash: string } => {
  const contentHash = createHash('sha256').update(options.body).digest('base64');
  const pathAndQuery = `${options.url.pathname}${options.url.search}`;
  const stringToSign = `${options.method}\n${pathAndQuery}\n${options.date};${options.url.host};${contentHash}`;
  const signature = createHmac('sha256', options.accessKey).update(stringToSign).digest('base64');

  return {
    contentHash,
    authorization: `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${signature}`,
  };
};

/** Sends one lead. Throws when ACS does not accept the message, so the caller can tell the visitor. */
export const sendLeadEmail = async (
  lead: DemoLead,
  config: AcsConfig,
  send: typeof fetch = fetch,
  now: () => Date = () => new Date()
): Promise<void> => {
  if (config.recipients.length === 0) {
    throw new Error('Lead delivery recipients are not configured.');
  }

  const url = new URL(`/emails:send?api-version=${apiVersion}`, config.endpoint);
  const body = JSON.stringify({
    senderAddress: config.sender,
    recipients: { to: config.recipients.map((address) => ({ address })) },
    replyTo: [{ address: toSingleLine(lead.email) }],
    content: {
      subject: 'New demo request from the meshX landing page',
      plainText: buildLeadBody(lead),
    },
  });
  const date = now().toUTCString();
  const { authorization, contentHash } = signAcsRequest({
    method: 'POST',
    url,
    body,
    date,
    accessKey: config.accessKey,
  });

  const response = await send(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ms-date': date,
      'x-ms-content-sha256': contentHash,
      authorization,
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`ACS returned ${response.status}`);
  }
};

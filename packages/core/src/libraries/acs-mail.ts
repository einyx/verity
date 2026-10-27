import { createHash, createHmac } from 'node:crypto';

// Sends plain-text mail through Azure Communication Services (ACS) Email. The platform uses it for
// the mail it sends on its own behalf: demo leads and tenant invitations. The connection details
// and the sender address come from the environment, so a deployment without them simply has no
// platform mail service and falls back to another way of sending.
//
// Every field is plain text, and line breaks are removed from anything that comes from a user, so
// nothing can add a header or a second message to the mail.

const apiVersion = '2023-03-31';

export type AcsMailConfig = {
  endpoint: URL;
  accessKey: Uint8Array;
  sender: string;
};

export type AcsMail = {
  /** One address, or several when the same mail goes to more than one recipient. */
  to: string | readonly string[];
  subject: string;
  text: string;
  /** The HTML body of the mail, for clients that render it. */
  html?: string;
  /** Files the mail carries, referenced from the HTML with `cid:<contentId>`. */
  attachments?: AcsAttachment[];
  /** Where a reply should go. Defaults to the sender. */
  replyTo?: string;
};

export type AcsAttachment = {
  contentType: string;
  /** The file, base64 encoded. */
  contentInBase64: string;
  /** The name of the file in the mail, with its extension. */
  name: string;
  /** The id the HTML refers to, as `cid:<contentId>`. */
  contentId: string;
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

/** Removes line breaks and collapses spaces, so a value stays on one line of the mail. */
export const toSingleLine = (value?: string | null): string =>
  (value ?? '')
    .replaceAll(/[\t\n\r]+/g, ' ')
    .replaceAll(/ {2,}/g, ' ')
    .trim();

/**
 * Reads the platform mail configuration from the environment. Returns undefined when the platform
 * has no mail service, so the caller can fall back to sending the mail another way.
 */
export const readAcsMailConfig = (): AcsMailConfig | undefined => {
  const connection = process.env.ACS_CONNECTION_STRING;
  const sender = process.env.ACS_SENDER_EMAIL;

  if (!connection || !sender) {
    return undefined;
  }

  const parsed = parseAcsConnectionString(connection);

  if (!parsed) {
    return undefined;
  }

  return { ...parsed, sender };
};

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

/** Sends one plain-text mail. Throws when ACS does not accept it, so the caller can undo its work. */
export const sendMail = async (
  mail: AcsMail,
  config: AcsMailConfig,
  send: typeof fetch = fetch,
  now: () => Date = () => new Date()
): Promise<void> => {
  const recipients = (Array.isArray(mail.to) ? mail.to : [mail.to])
    .map((address) => toSingleLine(address))
    .filter(Boolean);

  if (recipients.length === 0) {
    throw new Error('There is no recipient to send the mail to.');
  }

  const url = new URL(`/emails:send?api-version=${apiVersion}`, config.endpoint);
  const body = JSON.stringify({
    senderAddress: config.sender,
    recipients: { to: recipients.map((address) => ({ address })) },
    ...(mail.replyTo ? { replyTo: [{ address: toSingleLine(mail.replyTo) }] } : {}),
    content: {
      subject: mail.subject,
      plainText: mail.text,
      ...(mail.html ? { html: mail.html } : {}),
    },
    ...(mail.attachments?.length ? { attachments: mail.attachments } : {}),
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
    // The body says which part of the mail ACS refused, so the failure can be read.
    const detail = await response.text();
    throw new Error(`ACS returned ${response.status}: ${detail.slice(0, 500)}`);
  }
};

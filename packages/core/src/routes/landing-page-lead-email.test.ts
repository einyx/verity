/* eslint-disable @silverhand/fp/no-mutating-methods -- The sender tests record the request the fake transport receives. */
import {
  buildLeadBody,
  parseLeadRecipients,
  parseAcsConnectionString,
  sendLeadEmail,
  toSingleLine,
} from './landing-page-lead-email.js';

const key = Buffer.from('test-access-key').toString('base64');
const connectionString = `endpoint=https://example.communication.azure.com/;accesskey=${key}`;
const now = () => new Date('2026-10-20T12:00:00Z');
const denied = async () => new Response('denied', { status: 401 });

const lead = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  company: 'Analytical Engines',
  consent: true as const,
  interests: ['Dashboards', 'Agents'],
};

describe('parseAcsConnectionString', () => {
  it('reads the endpoint and the access key', () => {
    const parsed = parseAcsConnectionString(connectionString);

    expect(parsed?.endpoint.origin).toBe('https://example.communication.azure.com');
    expect(parsed?.accessKey.toString()).toBe('test-access-key');
  });

  it('returns undefined when either part is missing', () => {
    expect(parseAcsConnectionString('endpoint=https://example.communication.azure.com/')).toBe(
      undefined
    );
    expect(parseAcsConnectionString(`accesskey=${key}`)).toBe(undefined);
    expect(parseAcsConnectionString('')).toBe(undefined);
  });
});

describe('parseLeadRecipients', () => {
  it('trims a comma-separated list of configured recipients', () => {
    expect(parseLeadRecipients('sales@example.com, operations@example.com')).toEqual([
      'sales@example.com',
      'operations@example.com',
    ]);
  });

  it('returns no recipients when configuration is missing', () => {
    expect(parseLeadRecipients()).toEqual([]);
  });
});

describe('toSingleLine', () => {
  it('removes line breaks so a value cannot start a new line in the email', () => {
    expect(toSingleLine('Acme\r\nBcc: attacker@example.com')).toBe(
      'Acme Bcc: attacker@example.com'
    );
  });

  it('trims and collapses spaces', () => {
    expect(toSingleLine('  Acme   Corp  ')).toBe('Acme Corp');
    expect(toSingleLine()).toBe('');
  });
});

describe('buildLeadBody', () => {
  it('defaults the preferred contact to the work email', () => {
    const body = buildLeadBody(lead);
    expect(body).toContain('Preferred contact: Email');
    expect(body).toContain(`Contact detail: ${lead.email}`);
  });

  it('shows the chosen contact method and its detail', () => {
    const body = buildLeadBody({
      ...lead,
      contactMethod: 'phone',
      contactDetail: '+44 7700 900123',
    });
    expect(body).toContain('Preferred contact: Phone call');
    expect(body).toContain('Contact detail: +44 7700 900123');
  });

  it('lists the lead fields on their own lines', () => {
    const body = buildLeadBody(lead);

    expect(body).toContain('Name: Ada Lovelace');
    expect(body).toContain('Email: ada@example.com');
    expect(body).toContain('Interests: Dashboards, Agents');
    expect(body).toContain('Role: ');
  });

  it('keeps a multi-line company name on one line', () => {
    const body = buildLeadBody({ ...lead, company: 'Acme\nSecond line' });

    expect(body).toContain('Company: Acme Second line');
  });
});

describe('sendLeadEmail', () => {
  const config = {
    endpoint: new URL('https://example.communication.azure.com/'),
    accessKey: Buffer.from('test-access-key'),
    sender: 'noreply@example.azurecomm.net',
    recipients: ['sales@example.com', 'operations@example.com'],
  };

  it('posts the lead to configured recipients with a signed request', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const send = async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init: init ?? {} });

      return new Response(null, { status: 202 });
    };

    await sendLeadEmail(lead, config, send as typeof fetch, now);

    const [request] = requests;
    const headers = request?.init.headers as Record<string, string>;
    const payload = JSON.parse(String(request?.init.body)) as {
      recipients: { to: Array<{ address: string }> };
      replyTo: Array<{ address: string }>;
      content: { subject: string; plainText: string };
    };

    expect(request?.url).toBe(
      'https://example.communication.azure.com/emails:send?api-version=2023-03-31'
    );
    expect(
      payload.recipients.to.map((recipient: { address: string }) => recipient.address)
    ).toEqual(config.recipients);
    expect(payload.replyTo[0]?.address).toBe('ada@example.com');
    expect(payload.content.plainText).toContain('Name: Ada Lovelace');
    expect(headers['x-ms-date']).toBe('Tue, 20 Oct 2026 12:00:00 GMT');
    expect(headers.authorization).toMatch(
      /^HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=.+$/
    );
  });

  it('throws when ACS does not accept the message', async () => {
    await expect(sendLeadEmail(lead, config, denied as typeof fetch, now)).rejects.toThrow(
      'ACS returned 401'
    );
  });

  it('refuses to send when no recipients are configured', async () => {
    await expect(
      sendLeadEmail(lead, { ...config, recipients: [] }, denied as typeof fetch, now)
    ).rejects.toThrow('Lead delivery recipients are not configured.');
  });
});

/* eslint-enable @silverhand/fp/no-mutating-methods */

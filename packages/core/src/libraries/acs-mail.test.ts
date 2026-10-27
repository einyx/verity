import { sendMail, type AcsAttachment } from './acs-mail.js';

const { jest } = import.meta;

const config = {
  endpoint: new URL('https://example.communication.azure.com/'),
  accessKey: new Uint8Array([1, 2, 3]),
  sender: 'noreply@example.com',
};

const attachment: AcsAttachment = {
  contentType: 'image/png',
  contentInBase64: 'AAAA',
  name: 'meshx-logo.png',
  contentId: 'meshx-logo',
};

describe('sendMail', () => {
  it('sends the attachment under the name ACS expects', async () => {
    const send = jest.fn(
      async (_url: string | URL, _init?: RequestInit) => new Response('{}', { status: 202 })
    );

    await sendMail(
      {
        to: 'someone@example.com',
        subject: 'Hello',
        text: 'Hello',
        html: '<p>Hello</p>',
        attachments: [attachment],
      },
      config,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- the mock stands in for fetch.
      send as unknown as typeof fetch
    );

    const [, init] = send.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body));

    expect(body.content).toEqual({ subject: 'Hello', plainText: 'Hello', html: '<p>Hello</p>' });
    // ACS reads the file name from `name`; it refuses the mail when the field is missing.
    expect(body.attachments).toEqual([attachment]);
  });

  it('says what ACS refused when it does not accept the mail', async () => {
    const send = jest.fn(
      async (_url: string | URL, _init?: RequestInit) =>
        new Response('{"error":{"code":"BadRequest"}}', {
          status: 400,
        })
    );

    await expect(
      sendMail(
        { to: 'someone@example.com', subject: 'Hello', text: 'Hello' },
        config,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- the mock stands in for fetch.
        send as unknown as typeof fetch
      )
    ).rejects.toThrow('ACS returned 400: {"error":{"code":"BadRequest"}}');
  });
});

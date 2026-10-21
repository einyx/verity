import { turnstileSiteverifyUrl, verifyTurnstileToken } from './landing-page-turnstile.js';

const { jest } = import.meta;

const secret = 'test-secret';
const token = 'visitor-token';
const remoteIp = '203.0.113.7';

const respondWith = (body: unknown, status = 200) =>
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }));

afterEach(() => {
  jest.restoreAllMocks();
});

describe('verifyTurnstileToken', () => {
  it('refuses without asking Cloudflare when the secret is not configured', async () => {
    const fetchSpy = respondWith({ success: true });

    expect(await verifyTurnstileToken(undefined, token, remoteIp)).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses without asking Cloudflare when the visitor sent no token', async () => {
    const fetchSpy = respondWith({ success: true });

    expect(await verifyTurnstileToken(secret, undefined, remoteIp)).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('accepts a token that Cloudflare confirms, and sends the secret, token and IP', async () => {
    const fetchSpy = respondWith({ success: true });

    expect(await verifyTurnstileToken(secret, token, remoteIp)).toBe(true);

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe(turnstileSiteverifyUrl);
    expect(init?.method).toBe('POST');
    expect(String(init?.body)).toContain('secret=test-secret');
    expect(String(init?.body)).toContain('response=visitor-token');
    expect(String(init?.body)).toContain('remoteip=203.0.113.7');
  });

  it('refuses a token that Cloudflare rejects', async () => {
    respondWith({ success: false, 'error-codes': ['invalid-input-response'] });

    expect(await verifyTurnstileToken(secret, token, remoteIp)).toBe(false);
  });

  it('refuses when Cloudflare answers with an error status', async () => {
    respondWith({ success: true }, 500);

    expect(await verifyTurnstileToken(secret, token, remoteIp)).toBe(false);
  });

  it('refuses when the request fails, so an outage never lets sessions through', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    expect(await verifyTurnstileToken(secret, token, remoteIp)).toBe(false);
  });
});

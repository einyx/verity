import { signLeadFileQuery, verifyLeadFileQuery } from './landing-page-signed.js';

const secret = 'test-secret';
const sessionId = 'session-1';

const parse = (query: string) => Object.fromEntries(new URLSearchParams(query));

describe('signed lead file links', () => {
  it('accepts a link signed for the same file and session before it expires', () => {
    const now = 1_000_000_000_000;
    const query = parse(signLeadFileQuery(secret, 'brief', sessionId, now));

    expect(verifyLeadFileQuery(secret, 'brief', sessionId, query, now + 1000)).toBe(true);
  });

  it('refuses a link for another file kind or session', () => {
    const now = 1_000_000_000_000;
    const query = parse(signLeadFileQuery(secret, 'brief', sessionId, now));

    expect(verifyLeadFileQuery(secret, 'slides', sessionId, query, now)).toBe(false);
    expect(verifyLeadFileQuery(secret, 'brief', 'session-2', query, now)).toBe(false);
  });

  it('refuses a link signed with another secret', () => {
    const now = 1_000_000_000_000;
    const query = parse(signLeadFileQuery('other-secret', 'brief', sessionId, now));

    expect(verifyLeadFileQuery(secret, 'brief', sessionId, query, now)).toBe(false);
  });

  it('refuses an expired link', () => {
    const now = 1_000_000_000_000;
    const query = parse(signLeadFileQuery(secret, 'brief', sessionId, now));
    const eightDaysLater = now + 8 * 24 * 60 * 60 * 1000;

    expect(verifyLeadFileQuery(secret, 'brief', sessionId, query, eightDaysLater)).toBe(false);
  });
});

import { requestLeadResearch } from './landing-page-lead-research.js';

const { jest } = import.meta;

describe('advisory lead research', () => {
  beforeEach(() => {
    process.env.CLAUDE_LEAD_RESEARCH_URL = 'https://research.example.invalid/research';
    process.env.CLAUDE_LEAD_RESEARCH_TOKEN = 'synthetic-test-only';
  });
  afterEach(() => {
    jest.restoreAllMocks();
    Reflect.deleteProperty(process.env, 'CLAUDE_LEAD_RESEARCH_URL');
    Reflect.deleteProperty(process.env, 'CLAUDE_LEAD_RESEARCH_TOKEN');
  });
  it('fails closed before transport when the bridge is not configured', async () => {
    Reflect.deleteProperty(process.env, 'CLAUDE_LEAD_RESEARCH_URL');
    Reflect.deleteProperty(process.env, 'CLAUDE_LEAD_RESEARCH_TOKEN');
    const fetch = jest.spyOn(globalThis, 'fetch');
    await expect(requestLeadResearch('claude', {})).rejects.toMatchObject({ status: 501 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects non-HTTPS and credential-bearing finding URLs', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch');
    for (const sourceUrl of [
      'http://example.invalid/about',
      'https://user:pass@example.invalid/about',
    ]) {
      fetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            findings: [
              { summary: 'Synthetic finding', sourceUrl, retrievedAt: '2026-11-02T00:00:00.000Z' },
            ],
            draft: 'Unsent draft',
          }),
          { headers: { 'content-type': 'application/json' } }
        )
      );
      // eslint-disable-next-line no-await-in-loop -- Each synthetic provider response is independently rejected.
      await expect(requestLeadResearch('claude', {})).rejects.toMatchObject({ status: 502 });
    }
  });
  it('rejects an oversized chunked response without trusting content-length', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        ' '.repeat(100_001) +
          JSON.stringify({
            findings: [],
            draft: 'ok',
          }),
        { headers: { 'content-type': 'application/json' } }
      )
    );
    await expect(requestLeadResearch('claude', {})).rejects.toMatchObject({ status: 502 });
  });
  it('rejects endpoint credentials before making any request', async () => {
    process.env.CLAUDE_LEAD_RESEARCH_URL = 'https://user:pass@research.example.invalid/research';
    const fetch = jest.spyOn(globalThis, 'fetch');
    await expect(requestLeadResearch('claude', {})).rejects.toMatchObject({ status: 501 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('returns an unsent draft and sends only minimal profile context', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          findings: [],
          draft: 'Unsent draft',
        }),
        { headers: { 'content-type': 'application/json' } }
      )
    );
    await expect(
      requestLeadResearch('claude', {
        firstName: 'Ada',
        email: 'private@example.invalid',
        notes: 'private',
      })
    ).resolves.toEqual({ findings: [], draft: 'Unsent draft' });
    expect(fetch.mock.calls[0]?.[1]?.body).not.toContain('private');
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe('error');
  });
});

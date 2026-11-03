import { defaultLandingPageContent } from '@logto/schemas';

const { jest } = import.meta;
const { reviewLandingPage } = await import('./ai-chat-landing-review.js');

it('returns a transient preview using only editor GET and non-saving AI edit POST', async () => {
  const requests: Array<{ path: string; method: string }> = [];
  const before = structuredClone(defaultLandingPageContent);
  const result = await reviewLandingPage({
    instruction: 'Review the landing page and suggest one improvement. Do not save or publish.',
    getToken: async () => 'synthetic-editor-token',
    apiBase: 'https://cloud.example/api',
    fetchImpl: async (url, init) => {
      requests.push({ path: String(url), method: init?.method ?? 'GET' });
      return new Response(JSON.stringify({ draft: defaultLandingPageContent }));
    },
  });
  expect(result).toMatchObject({ draft: before });
  expect(requests).toEqual([
    { path: 'https://cloud.example/api/landing-page/editor', method: 'GET' },
    { path: 'https://cloud.example/api/landing-page/ai-edit', method: 'POST' },
  ]);
  expect(defaultLandingPageContent).toEqual(before);
  expect(result).not.toHaveProperty('id');
  expect(result).not.toHaveProperty('actions');
});

it('checks authorization before fetching private content or generating a preview', async () => {
  const fetchImpl = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
  await expect(reviewLandingPage({ instruction: 'Review', getToken: async () => { throw new Error('denied'); }, apiBase: 'https://cloud.example/api', fetchImpl })).rejects.toThrow('denied');
  expect(fetchImpl).not.toHaveBeenCalled();
});

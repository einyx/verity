import { adminTenantId } from '@logto/schemas';
import { createMockUtils } from '@logto/shared/esm';

const { jest } = import.meta;
const { mockEsm, mockEsmWithActual } = createMockUtils(jest);
const sessionId = 'budget-test-session';
const sources = [
  {
    sourceUrl: 'https://example.test/about',
    quote: 'We serve businesses',
    signal: 'Scale context only',
  },
];
const modelBudget = {
  indicativeAnnualRange: { low: 1000, base: 2000, high: 3000 },
  confidence: 'medium',
  rationale: ['Public context'],
  assumptions: ['Scope unconfirmed'],
  discoveryQuestions: ['What is approved?'],
  evidence: sources,
};
const storedLead = { company: 'Example Company', decision: 'Show SSO', email: 'rep@example.test' };

/** Reads the token budget a request asks for, so the mock can answer each call differently. */
const readMaxTokens = (body: unknown): number | undefined => {
  if (typeof body !== 'object' || body === null || !('max_tokens' in body)) {
    return undefined;
  }

  const { max_tokens: maxTokens } = body;

  return typeof maxTokens === 'number' ? maxTokens : undefined;
};
const maybeOne = jest.fn<Promise<unknown>, [{ sql: string; values: unknown[] }]>();
mockEsm('#src/env-set/index.js', () => ({ EnvSet: { sharedPool: Promise.resolve({ maybeOne }) } }));
mockEsm('node:dns/promises', () => ({ lookup: async () => [{ address: '203.0.113.8' }] }));
/** The company profile the chat store persists for a lead. */
type SavedProfile = {
  readonly summary?: string;
  readonly budgetAssessment?: unknown;
};

const saveLeadCompanyProfile = jest.fn<void, [unknown, string, SavedProfile]>();
const saveLeadConversationInsight = jest.fn<void, [unknown, string, unknown]>();
await mockEsmWithActual('./landing-page-chat-store.js', () => ({
  saveLeadCompanyProfile,
  saveLeadConversationInsight,
}));
const postLeadToSlack = jest.fn(async () => {
  // The Slack call is stubbed: the test only needs to know that it happened.
});
mockEsm('./landing-page-slack.js', () => ({ postLeadToSlack }));
const { createProductionChatDeps } = await import('./landing-page-chat.js');

const fakeFetch = (budgetReply: unknown = modelBudget) =>
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (init?.method !== 'POST') {
      return new Response(String(url).endsWith('robots.txt') ? '' : '<p>We serve businesses</p>');
    }
    const body: unknown = JSON.parse(String(init.body));
    const maxTokens = readMaxTokens(body);
    const content =
      maxTokens === 1000
        ? JSON.stringify(budgetReply)
        : maxTokens === 300
          ? 'Independent summary'
          : JSON.stringify({ tone: 'Curious', outcomes: [], nextSteps: [] });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
  });

beforeEach(() => {
  jest.clearAllMocks();
  maybeOne.mockResolvedValueOnce({ lead: storedLead }).mockResolvedValueOnce({
    lead: storedLead,
    emailStatus: 'sent',
    companyProfile: { summary: 'Independent summary' },
  });
});
afterEach(() => {
  jest.restoreAllMocks();
});

it('uses tenant-bound explicit company/decision and persists a guarded budget alongside the summary', async () => {
  const fetchMock = fakeFetch();
  await createProductionChatDeps().researchCompany?.(sessionId, 'rep@example.test', []);
  const query = maybeOne.mock.calls[0]?.[0];
  expect(query?.sql).toContain('where tenant_id =');
  expect(query?.values).toEqual([adminTenantId, sessionId]);
  const savedProfile = saveLeadCompanyProfile.mock.calls[0]?.[2];
  expect(savedProfile?.summary).toBe('Independent summary');
  expect(savedProfile?.budgetAssessment).toMatchObject({
    demoMonthly: 150,
    bankAnnualPlanningAnchor: 1_500_000,
    opportunityBudgetStatus: 'not_disclosed',
    evidence: sources,
  });
  const modelCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
  const budgetCall = modelCalls.find(([, init]) =>
    String(init?.body).includes('"max_tokens":1000')
  );
  expect(budgetCall?.[0]).toBe(
    `${process.env.OPENAI_API_PROXY_ENDPOINT ?? 'https://api.openai.com/v1'}/chat/completions`
  );
  expect(String(budgetCall?.[1]?.body)).toContain('Example Company');
  expect(String(budgetCall?.[1]?.body)).toContain('Show SSO');
  expect(modelCalls).toHaveLength(3);
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method !== 'POST')).toHaveLength(9);
  expect(saveLeadConversationInsight).toHaveBeenCalledTimes(1);
  expect(postLeadToSlack).toHaveBeenCalledTimes(1);
});

it('keeps company summary, independent conversation analysis and Slack on invalid model budget', async () => {
  fakeFetch({ inventedBudget: 99 });
  await createProductionChatDeps().researchCompany?.(sessionId, 'rep@example.test', []);
  expect(saveLeadCompanyProfile.mock.calls[0]?.[2]?.budgetAssessment).toBeUndefined();
  expect(saveLeadCompanyProfile).toHaveBeenCalledWith(
    expect.anything(),
    sessionId,
    expect.objectContaining({ summary: 'Independent summary' })
  );
  expect(saveLeadConversationInsight).toHaveBeenCalledTimes(1);
  expect(postLeadToSlack).toHaveBeenCalledTimes(1);
});

it('does not coerce unknown stored company objects into budget input', async () => {
  maybeOne
    .mockReset()
    .mockResolvedValueOnce({ lead: { company: { name: 'Not a string' }, decision: {} } })
    .mockResolvedValueOnce(null);
  const fetchMock = fakeFetch();
  await createProductionChatDeps().researchCompany?.(sessionId, 'rep@example.test', []);
  expect(
    fetchMock.mock.calls.some(([, init]) => String(init?.body).includes('"max_tokens":1000'))
  ).toBe(false);
  expect(saveLeadConversationInsight).toHaveBeenCalledTimes(1);
});

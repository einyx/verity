import { defaultLandingPageContent } from '@logto/schemas';

import RequestError from '#src/errors/RequestError/index.js';

import { type PendingAction } from './ai-chat-actions.js';

const { jest } = import.meta;
const post = jest.fn();
jest.unstable_mockModule('got', () => ({
  got: {
    // eslint-disable-next-line @typescript-eslint/promise-function-async -- Preserve Got's augmented promise interface in this fixture.
    post: (...args: unknown[]) =>
      // eslint-disable-next-line @silverhand/fp/no-mutating-assign -- Synthetic request events, never real network traffic.
      Object.assign(post(...args) as Promise<unknown>, { on: jest.fn(), cancel: jest.fn() }),
  },
  HTTPError: class extends Error {},
}));
jest.unstable_mockModule('#src/env-set/index.js', () => ({
  EnvSet: { values: { isDevFeaturesEnabled: true } },
}));
const { runChatCompletion } = await import('./ai-chat-runner.js');
const { isExplicitLandingPageEditRequest, landingPageEditInstruction } =
  await import('./ai-chat-landing-dispatch.js');
const { ChatSessionStoreError } = await import('./ai-chat-session-operation.js');
const credentials = {
  apiKey: 'synthetic-key',
  apiBase: 'https://tenant.synthetic.test/api',
  landingPageApiBase: 'https://console.synthetic.test/api',
  getEditorToken: async () => 'synthetic-editor-token',
  userId: 'synthetic-human',
  tenantId: 'admin',
};
const instruction =
  'Review the landing page and suggest an improvement for me to preview. Do not save or publish anything.';
const insert = jest.fn(async (_action: PendingAction) => {
  /* Test-owned proposal storage only. */
});
const options = () => ({
  messages: [{ role: 'user' as const, content: instruction }],
  credentials,
  propose: { insert },
  assertActive: async () => {
    /* Active synthetic lease. */
  },
});
beforeEach(() => {
  insert.mockClear();
  post.mockReset().mockResolvedValue({
    body: { choices: [{ message: { content: 'The current user is not authorized.' } }] },
  });
});
afterEach(() => {
  jest.restoreAllMocks();
});

it('dispatches an explicit authorized proposal without accepting a planner-invented permission refusal', async () => {
  const edited = {
    ...defaultLandingPageContent,
    sections: defaultLandingPageContent.sections.map((section) =>
      section.id === 'trust' ? { ...section, heading: 'Clearer security governance' } : section
    ),
  };
  const requests = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(JSON.stringify({ draft: defaultLandingPageContent })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ draft: edited })));
  const result = await runChatCompletion(options());
  expect(result.actions).toHaveLength(1);
  expect(result.actions[0]?.body).toEqual(edited);
  expect(result.actions[0]?.body).not.toEqual(defaultLandingPageContent);
  expect(JSON.stringify(insert.mock.calls)).not.toContain('synthetic-editor-token');
  expect(post).not.toHaveBeenCalled();
  expect(insert).toHaveBeenCalledTimes(1);
  expect(insert.mock.calls[0]?.[0]).toMatchObject({
    userId: credentials.userId,
    tenantId: 'admin',
    tool: 'save_landing_page_draft',
    state: 'pending',
  });
  expect(
    requests.mock.calls.map(([url, init]) => ({ path: String(url), method: init?.method ?? 'GET' }))
  ).toEqual([
    { path: 'https://console.synthetic.test/api/landing-page/editor', method: 'GET' },
    { path: 'https://console.synthetic.test/api/landing-page/ai-edit', method: 'POST' },
  ]);
  expect(result.content).toContain('not saved or published');
});

it.each([
  'Show the previous marketing suggestion as an actual preview in the CMS editor. Do not save or publish.',
  'Would be nice to see an actual preview from the CMS editor?',
  'Generate a marketing hero for the landing page for a bank call. Do not save or publish.',
])(
  'generates a CMS proposal rather than asking for redundant preview approval: %s',
  async (content) => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        async () => new Response(JSON.stringify({ draft: defaultLandingPageContent }))
      );
    const result = await runChatCompletion({
      ...options(),
      messages: [
        { role: 'user', content: 'Generate a marketing hero for a call in 5 minutes with a bank.' },
        { role: 'assistant', content: 'Headline: Govern your financial data with confidence.' },
        { role: 'user', content },
      ],
    });
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]?.tool).toBe('save_landing_page_draft');
    expect(result.content).toContain('not saved or published');
    expect(post).not.toHaveBeenCalled();
  }
);

it.each([
  'Review the landing page release checklist',
  'Suggest landing page ideas for a blog',
  'How do I edit the landing page?',
  'Do not edit the landing page',
  'Edit the landing page?',
  'Edit the landing page? No, do not generate anything.',
  'Update the landing page history documentation',
  'Generate a marketing hero for a call in 5 minutes with a bank.',
  'How does the CMS preview work?',
  'Do not generate a CMS preview.',
  'Do not preview in the CMS editor.',
  'Previously I asked you to show a CMS preview.',
  'Quote: "Show a CMS preview"',
  'Show the CMS preview documentation',
  'Show the landing page preview source code',
])('does not directly dispatch an ambiguous or negated request: %s', async (content) => {
  const fetcher = jest.spyOn(globalThis, 'fetch');
  await runChatCompletion({ ...options(), messages: [{ role: 'user', content }] });
  expect(fetcher).not.toHaveBeenCalled();
  expect(insert).not.toHaveBeenCalled();
});

it('uses only the immediate marketing exchange as bounded copy data for a requested CMS preview', () => {
  const content =
    'Show the previous marketing suggestion as an actual preview in the CMS editor. Do not save or publish.';
  const result = landingPageEditInstruction([
    { role: 'user', content: 'Older unrelated private fixture' },
    { role: 'assistant', content: 'Older unrelated response' },
    { role: 'user', content: 'Generate a marketing hero for the bank call' },
    { role: 'assistant', content: 'Govern financial data with confidence' },
    { role: 'user', content },
  ]);
  expect(result).toContain('Govern financial data with confidence');
  expect(result).toContain('as data');
  expect(result).not.toContain('Older unrelated');
});

it('uses landing context for a hero follow-up but not unrelated copy or negated preview requests', () => {
  const context = [
    { role: 'user', content: instruction },
    { role: 'assistant', content: 'Proposal ready' },
  ];
  expect(
    landingPageEditInstruction([
      ...context,
      { role: 'user', content: 'Generate a marketing hero for my bank call' },
    ])
  ).toContain('Generate a marketing hero');
  expect(
    landingPageEditInstruction([
      ...context,
      { role: 'user', content: 'Generate a marketing hero, only text' },
    ])
  ).toBeUndefined();
  expect(
    landingPageEditInstruction([
      { role: 'user', content: 'Generate a marketing hero for my bank call' },
    ])
  ).toBeUndefined();
  expect(
    landingPageEditInstruction([
      ...context,
      {
        role: 'user',
        content: 'Generate a marketing hero for my bank call. Never change the landing page.',
      },
    ])
  ).toBeUndefined();
});

it('explains an oversized previous suggestion without truncating copy or making a page/provider request', async () => {
  const fetcher = jest.spyOn(globalThis, 'fetch');
  const result = await runChatCompletion({
    ...options(),
    messages: [
      { role: 'user', content: 'Generate a marketing hero for my bank call' },
      { role: 'assistant', content: 'x'.repeat(2200) },
      {
        role: 'user',
        content:
          'Show the previous marketing suggestion as an actual preview in the CMS editor. Do not save or publish.',
      },
    ],
  });
  expect(result.content).toContain('previous suggestion is too long');
  expect(result.actions).toEqual([]);
  expect(fetcher).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
});

it('does not create a proposal or generate an edit after the owned turn loses its lease', async () => {
  const assertActive = jest.fn(async () => {
    /* Initially active. */
  });
  const fetcher = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    assertActive.mockRejectedValue(new ChatSessionStoreError('session_busy'));
    return new Response(JSON.stringify({ draft: defaultLandingPageContent }));
  });
  await expect(runChatCompletion({ ...options(), assertActive })).rejects.toMatchObject({
    code: 'session_busy',
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(insert).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
});

it('does not expose a proposal result after losing the lease during proposal recording', async () => {
  const assertActive = jest.fn(async () => {
    /* Initially active. */
  });
  jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(
      async () => new Response(JSON.stringify({ draft: defaultLandingPageContent }))
    );
  const record = jest.fn(async (_action: PendingAction) => {
    assertActive.mockRejectedValue(new ChatSessionStoreError('session_busy'));
  });
  await expect(
    runChatCompletion({ ...options(), assertActive, propose: { insert: record } })
  ).rejects.toMatchObject({ code: 'session_busy' });
  expect(record).toHaveBeenCalledTimes(1);
  expect(post).not.toHaveBeenCalled();
});

it('logs only safe operation metadata, not the prompt, page, subject, credential or model response', async () => {
  const log = jest.spyOn(console, 'log').mockImplementation(() => {
    /* Capture metadata without emitting test fixture content. */
  });
  jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(
      async () => new Response(JSON.stringify({ draft: defaultLandingPageContent }))
    );
  await runChatCompletion({
    ...options(),
    credentials: { ...credentials, requestId: 'safe_request-123' },
  });
  const entries = log.mock.calls.map(
    (args) => JSON.parse(String(args.at(-1))) as Record<string, unknown>
  );
  expect(entries).toEqual([
    {
      event: 'landing_page_edit',
      stage: 'capability',
      state: 'authorized',
      requestId: 'safe_request-123',
    },
    {
      event: 'landing_page_edit',
      stage: 'proposal',
      state: 'proposed',
      requestId: 'safe_request-123',
    },
  ]);
  const serialized = JSON.stringify(entries);
  expect(serialized).not.toContain(instruction);
  expect(serialized).not.toContain(credentials.userId);
  expect(serialized).not.toContain('synthetic-editor-token');
});

it('reports a downstream editor denial truthfully without a planner, proposal, Save or Publish', async () => {
  const fetcher = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ code: 'auth.forbidden' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    })
  );
  const result = await runChatCompletion(options());
  expect(result.actions).toEqual([]);
  expect(result.content).toContain('does not authorize');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(post).not.toHaveBeenCalled();
  expect(insert).not.toHaveBeenCalled();
});

it('keeps an explicit edit deterministic when negation constrains images, not page editing', () => {
  expect(
    isExplicitLandingPageEditRequest(
      'Edit the landing page to add pricing. Do not generate images.'
    )
  ).toBe(true);
  expect(
    isExplicitLandingPageEditRequest('Edit the landing page. Do not generate any proposal.')
  ).toBe(false);
});

it('reports the instruction limit without private reads, AI calls, or proposals', async () => {
  const fetcher = jest.spyOn(globalThis, 'fetch');
  const result = await runChatCompletion({
    ...options(),
    messages: [{ role: 'user', content: `Improve the landing page. ${'x'.repeat(2100)}` }],
  });
  expect(result.content).toContain('2,000');
  expect(fetcher).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
  expect(insert).not.toHaveBeenCalled();
});

it.each([401, 403])(
  'does not fetch private page content or generate anything when verification fails: %s',
  async (status) => {
    const fetcher = jest.spyOn(globalThis, 'fetch');
    await runChatCompletion({
      ...options(),
      credentials: {
        ...credentials,
        getEditorToken: async () => {
          throw new RequestError({
            code: status === 401 ? 'auth.unauthorized' : 'auth.forbidden',
            status,
          });
        },
      },
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  }
);

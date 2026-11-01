import { defaultLandingPageContent } from '@logto/schemas';

import { refreshDraftReview } from './refresh-draft-review';

const action = { id: 'expired', tool: 'save_landing_page_draft', body: defaultLandingPageContent };

it('requests only a new review of the exact validated draft, never a save or publish', async () => {
  const propose = jest.fn(async (_request: unknown) => ({
    id: 'fresh',
    tool: action.tool,
    body: action.body,
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  }));
  const renewed = await refreshDraftReview(action, propose);
  expect(propose).toHaveBeenCalledWith({
    tool: 'save_landing_page_draft',
    arguments: { draft: defaultLandingPageContent },
  });
  expect(renewed).toMatchObject({
    id: 'fresh',
    body: defaultLandingPageContent,
    status: 'pending',
  });
});

it('rejects a refresh response that changes the proposed draft', async () => {
  await expect(
    refreshDraftReview(action, async () => ({
      id: 'fresh',
      tool: action.tool,
      body: { ...action.body, demoChat: { enabled: false } },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }))
  ).rejects.toThrow();
});

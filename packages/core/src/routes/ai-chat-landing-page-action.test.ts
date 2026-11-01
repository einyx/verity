import { defaultLandingPageContent } from '@logto/schemas';

import { type PendingActionStore } from './ai-chat-actions.js';

const { jest } = import.meta;
const clock = { value: new Date('2026-11-01T12:00:00Z') };
const propose = jest.fn(async (_options: { now: Date }) => 'proposal');
const edit = jest.fn(async () => {
  // eslint-disable-next-line @silverhand/fp/no-mutation -- Simulates model latency before the review is created.
  clock.value = new Date('2026-11-01T12:02:00Z');
  return defaultLandingPageContent;
});
jest.unstable_mockModule('./ai-chat-actions.js', () => ({ proposeAndRecordAction: propose }));
jest.unstable_mockModule('./ai-chat-landing-page.js', () => ({
  editLandingPageDraft: edit,
  saveLandingPageDraftTool: { name: 'save_landing_page_draft' },
}));
const { proposeLandingPageEdit } = await import('./ai-chat-landing-page-action.js');
const store: PendingActionStore = {
  insert: jest.fn(),
  findById: jest.fn(),
  claim: jest.fn(),
  cancel: jest.fn(),
  setOutcome: jest.fn(),
};

it('starts the human review clock after the AI edit is generated', async () => {
  await proposeLandingPageEdit({
    instruction: 'Improve the headline',
    apiBase: 'https://console.example.com/api',
    token: 'test-token',
    store,
    actions: new Map(),
    userId: 'user',
    tenantId: 'admin',
    now: () => clock.value,
  });
  expect(propose.mock.calls[0]?.[0].now).toEqual(new Date('2026-11-01T12:02:00Z'));
});

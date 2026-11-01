import { confirmChatAction } from './confirm-action';

it('refreshes the landing editor only after a confirmed draft save', async () => {
  const state = { saved: false, canvas: 'Old draft' };
  await confirmChatAction(
    { id: 'proposal', tool: 'save_landing_page_draft' },
    async () => {
      // eslint-disable-next-line @silverhand/fp/no-mutation -- Represents the server accepting the explicit confirmation in this test.
      state.saved = true;
    },
    async () => {
      expect(state.saved).toBe(true);
      // eslint-disable-next-line @silverhand/fp/no-mutation -- Represents the editor receiving the revalidated draft.
      state.canvas = 'Confirmed AI draft';
    }
  );
  expect(state.canvas).toBe('Confirmed AI draft');
});

it('never refreshes on a failed confirmation or an unrelated tool', async () => {
  const refresh = jest.fn();
  await expect(
    confirmChatAction(
      { id: 'proposal', tool: 'save_landing_page_draft' },
      async () => {
        throw new Error('Expired');
      },
      refresh
    )
  ).rejects.toThrow('Expired');
  expect(refresh).not.toHaveBeenCalled();
  await confirmChatAction(
    { id: 'proposal', tool: 'create_organization' },
    async () => ({}),
    refresh
  );
  expect(refresh).not.toHaveBeenCalled();
});

it('does not call a successful server save failed just because refreshing the editor fails', async () => {
  await expect(
    confirmChatAction(
      { id: 'proposal', tool: 'save_landing_page_draft' },
      async () => ({}),
      async () => {
        throw new Error('Offline');
      }
    )
  ).resolves.toBeUndefined();
});

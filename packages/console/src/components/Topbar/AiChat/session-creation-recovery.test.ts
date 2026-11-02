/** @jest-environment node */
import { composer, deferred, session, setup, timestamp } from './session-controller.test-helper';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('loads authoritative state before binding an uncached idempotent creation result', async () => {
  const { api, controller } = setup();
  try {
    api.create.mockRejectedValueOnce(new Error('Response lost'));
    controller.setText('Original unbound draft');
    await controller.newSession();
    api.composer.mockResolvedValueOnce({
      ...composer('Other device draft', 2),
      attachments: [{ id: 'remote', name: 'remote.txt', text: 'Remote unsent file' }],
    });
    expect(await controller.newSession()).toBeUndefined();
    expect(controller.getSnapshot().records.one?.draft).toMatchObject({
      text: 'Other device draft',
      attachments: [{ id: 'remote' }],
    });
    expect(controller.getSnapshot().emptyDraft.text).toBe('Original unbound draft');
    expect(controller.getSnapshot().creationConflictId).toBe('one');
    expect(api.saveComposer).not.toHaveBeenCalled();
  } finally {
    controller.dispose();
  }
});

it('does not adopt an unbound draft into an archived recovered conversation', async () => {
  const { api, controller } = setup();
  try {
    api.create.mockRejectedValueOnce(new Error('Response lost'));
    controller.setText('Original unbound draft');
    await controller.newSession();
    api.get.mockResolvedValueOnce({ ...session('one'), archivedAt: timestamp });
    await controller.openSession('one');
    expect(await controller.newSession()).toBeUndefined();
    expect(controller.getSnapshot().records.one?.draft.text).toBe('');
    expect(controller.getSnapshot().emptyDraft.text).toBe('Original unbound draft');
    expect(controller.getSnapshot().creationConflictId).toBe('one');
    expect(api.update).not.toHaveBeenCalled();
    expect(api.saveComposer).not.toHaveBeenCalled();
  } finally {
    controller.dispose();
  }
});

it('creation recovery preserves both drafts, newer files and hydrated conversation state before explicit recovery', async () => {
  const { api, controller } = setup();
  try {
    api.create.mockRejectedValueOnce(new Error('Response lost after server commit'));
    controller.setText('ORIGINAL_UNBOUND_TEXT');
    await controller.newSession();
    await controller.list();
    api.messages.mockResolvedValueOnce({
      items: [
        {
          id: 'message',
          sequence: 1,
          turnId: 'turn',
          role: 'assistant',
          content: 'Stored response',
          createdAt: timestamp,
          reviews: [],
        },
      ],
      nextCursor: null,
    });
    await controller.openSession('one');
    controller.setText('NEWER_UNSENT_TEXT');
    controller.addAttachments([{ id: 'new', name: 'new.txt', text: 'NEWER_UNSENT_FILE' }]);
    const before = controller.getSnapshot().records.one;
    // Same sequence as New chat: retry creation, then flush only if it returns a usable ID.
    const recovered = await controller.newSession();
    if (recovered) {
      await controller.flush(recovered);
    }
    expect(api.create.mock.calls[0]).toEqual(api.create.mock.calls[1]);
    expect(controller.getSnapshot().records.one).toBe(before);
    expect(controller.getSnapshot().records.one?.draft).toMatchObject({
      text: 'NEWER_UNSENT_TEXT',
      attachments: [{ id: 'new', name: 'new.txt', text: 'NEWER_UNSENT_FILE' }],
    });
    expect(controller.getSnapshot().records.one?.messages).toHaveLength(1);
    expect(controller.getSnapshot().emptyDraft.text).toBe('ORIGINAL_UNBOUND_TEXT');
    expect(controller.getSnapshot().creationConflictId).toBe('one');
    expect(api.saveComposer).not.toHaveBeenCalled();

    // Only this explicit recovery creates another conversation for the original unbound draft.
    api.create.mockRejectedValueOnce(new Error('Recovery response lost'));
    expect(await controller.recoverCreation()).toBeUndefined();
    expect(controller.getSnapshot().creationConflictId).toBe('one');
    expect(controller.getSnapshot().emptyDraft.text).toBe('ORIGINAL_UNBOUND_TEXT');
    api.create.mockResolvedValueOnce(session('recovered'));
    const id = await controller.recoverCreation();
    if (id) {
      await controller.flush(id);
    }
    expect(id).toBe('recovered');
    expect(api.create.mock.calls[2]).not.toEqual(api.create.mock.calls[0]);
    expect(api.create.mock.calls[3]).toEqual(api.create.mock.calls[2]);
    expect(controller.getSnapshot().records.one).toBe(before);
    expect(controller.getSnapshot().records.recovered?.draft.text).toBe('ORIGINAL_UNBOUND_TEXT');
    expect(api.saveComposer).toHaveBeenLastCalledWith(
      'recovered',
      expect.objectContaining({ text: 'ORIGINAL_UNBOUND_TEXT', attachments: [] })
    );
    expect(controller.getSnapshot().creationConflictId).toBeUndefined();
  } finally {
    controller.dispose();
  }
});

it('adopts the original draft into its still-pristine recovered session without another creation identity', async () => {
  const { api, controller } = setup();
  try {
    api.create.mockRejectedValueOnce(new Error('Response lost'));
    controller.setText('Original draft');
    await controller.newSession();
    await controller.openSession('one');
    const id = await controller.newSession();
    expect(id).toBe('one');
    expect(api.create).toHaveBeenCalledTimes(2);
    expect(api.create.mock.calls[0]).toEqual(api.create.mock.calls[1]);
    expect(controller.getSnapshot().records.one?.draft.text).toBe('Original draft');
    expect(controller.getSnapshot().emptyDraft.text).toBe('');
    expect(controller.getSnapshot().creationConflictId).toBeUndefined();
  } finally {
    controller.dispose();
  }
});

it('recovering an empty creation never resets loaded messages, metadata, review or operation ownership', async () => {
  const { api, controller } = setup();
  try {
    api.create.mockRejectedValueOnce(new Error('offline'));
    await controller.newSession();
    api.get.mockResolvedValueOnce({ ...session('one'), title: 'Current title', revision: 4 });
    api.messages.mockResolvedValueOnce({
      items: [
        {
          id: 'message',
          sequence: 1,
          turnId: 'turn',
          role: 'assistant',
          content: 'Stored response',
          createdAt: timestamp,
          reviews: [],
        },
      ],
      nextCursor: null,
    });
    api.reviews.mockResolvedValueOnce([
      {
        originalActionId: 'original',
        currentActionId: 'current',
        tool: 'create_organization',
        body: { name: 'Synthetic' },
        expiresAt: '2026-11-03T00:00:00.000Z',
        state: 'pending',
        isError: null,
      },
    ]);
    await controller.openSession('one');
    const pending = deferred<unknown>();
    const operation = controller.reviewOperation('one', async () => pending.promise);
    try {
      const before = controller.getSnapshot().records.one;
      expect(await controller.newSession()).toBe('one');
      expect(controller.getSnapshot().records.one).toBe(before);
      expect(controller.getSnapshot().records.one?.operation).toBe(true);
      expect(controller.getSnapshot().records.one?.reviews[0]?.currentActionId).toBe('current');
      expect(controller.getSnapshot().history[0]?.title).toBe('Current title');
      expect(api.saveComposer).not.toHaveBeenCalled();
    } finally {
      pending.resolve({});
      await operation;
    }
  } finally {
    controller.dispose();
  }
});

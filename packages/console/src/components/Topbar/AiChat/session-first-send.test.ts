/** @jest-environment node */
import { type ChatComposer, type ChatSession, type CreateTurnInput } from '@logto/schemas';

import { composer, deferred, session, setup, timestamp } from './session-controller.test-helper';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const fixture = () => {
  const state = setup();
  const stored = new Map<string, ChatComposer>([['one', composer()]]);
  state.api.composer.mockImplementation(async (id) =>
    structuredClone(stored.get(id) ?? composer())
  );
  state.api.saveComposer.mockImplementation(async (id, input) => {
    const saved = {
      ...composer(input.text, input.expectedRevision + 1),
      attachments: structuredClone(input.attachments),
    };
    stored.set(id, saved);
    return structuredClone(saved);
  });
  state.api.turn.mockImplementation(async (id: string, input: CreateTurnInput) => {
    const current = stored.get(id);
    // The real turn store clears only the composer revision acknowledged by the clicked send.
    if (current?.revision === input.composerRevision) {
      stored.set(id, composer('', current.revision + 1));
    }
    return {
      id: 'turn',
      requestId: input.requestId,
      state: 'completed',
      errorCode: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: timestamp,
      messageIds: [],
    };
  });
  return { ...state, stored };
};

it.each(['creation', 'canonical composer'] as const)(
  'immediate first send owns its saved revision while awaiting %s',
  async (phase) => {
    const { api, controller, stored } = fixture();
    const created = deferred<ChatSession>();
    const canonical = deferred<ChatComposer>();
    const loading = deferred<void>();
    if (phase === 'creation') {
      api.create.mockImplementationOnce(async () => created.promise);
    } else {
      api.composer.mockImplementationOnce(async () => {
        loading.resolve();
        return canonical.promise;
      });
    }
    try {
      controller.setText('CLICKED FIRST PROMPT');
      controller.addAttachments([{ id: 'original', name: 'original.txt', text: 'Clicked file' }]);
      if (phase === 'canonical composer') {
        await loading.promise;
      }
      const send = controller.send();
      if (phase === 'creation') {
        created.resolve(session('one'));
      } else {
        canonical.resolve(composer());
      }
      await send;
      expect(api.turn).toHaveBeenCalledTimes(1);
      expect(api.turn).toHaveBeenCalledWith(
        'one',
        expect.objectContaining({
          composerRevision: 1,
          text: 'CLICKED FIRST PROMPT',
          attachments: [{ id: 'original', name: 'original.txt', text: 'Clicked file' }],
        })
      );
      expect(stored.get('one')).toMatchObject({ text: '', attachments: [] });
      expect(controller.getSnapshot().records.one?.draft).toMatchObject({
        text: '',
        attachments: [],
      });
    } finally {
      controller.dispose();
    }
  }
);

it.each(['creation', 'canonical composer'] as const)(
  'later text and files survive the first send awaiting %s',
  async (phase) => {
    const { api, controller, stored } = fixture();
    const created = deferred<ChatSession>();
    const canonical = deferred<ChatComposer>();
    const loading = deferred<void>();
    if (phase === 'creation') {
      api.create.mockImplementationOnce(async () => created.promise);
    } else {
      api.composer.mockImplementationOnce(async () => {
        loading.resolve();
        return canonical.promise;
      });
    }
    try {
      controller.setText('CLICKED FIRST PROMPT');
      controller.addAttachments([{ id: 'original', name: 'original.txt', text: 'Clicked file' }]);
      if (phase === 'canonical composer') {
        await loading.promise;
      }
      const send = controller.send();
      controller.setText('Newer typing');
      controller.removeAttachment('original');
      controller.addAttachments([{ id: 'newer', name: 'newer.txt', text: 'Newer file' }]);
      if (phase === 'creation') {
        created.resolve(session('one'));
      } else {
        canonical.resolve(composer());
      }
      await send;
      expect(api.turn).toHaveBeenCalledTimes(1);
      expect(api.turn).toHaveBeenCalledWith(
        'one',
        expect.objectContaining({
          composerRevision: 0,
          text: 'CLICKED FIRST PROMPT',
          attachments: [{ id: 'original', name: 'original.txt', text: 'Clicked file' }],
        })
      );
      expect(stored.get('one')).toMatchObject({
        text: 'Newer typing',
        attachments: [{ id: 'newer' }],
      });
      expect(controller.getSnapshot().records.one?.draft).toMatchObject({
        text: 'Newer typing',
        attachments: [{ id: 'newer' }],
      });
    } finally {
      controller.dispose();
    }
  }
);

it('a remote draft arriving while send awaits its acknowledged title update is never cleared', async () => {
  const { api, controller, stored } = fixture();
  const acknowledged = deferred<void>();
  const title = deferred<ChatSession>();
  try {
    await controller.openSession('one');
    api.update.mockImplementationOnce(async () => {
      acknowledged.resolve();
      return title.promise;
    });
    controller.setText('Clicked existing prompt');
    const send = controller.send();
    await acknowledged.promise;
    stored.set('one', {
      ...composer('New remote draft', 2),
      attachments: [{ id: 'remote', name: 'remote.txt', text: 'Remote file' }],
    });
    await controller.refresh('one');
    title.resolve({ ...session('one'), revision: 1 });
    await send;
    expect(api.turn).toHaveBeenCalledWith(
      'one',
      expect.objectContaining({ composerRevision: 1, text: 'Clicked existing prompt' })
    );
    expect(stored.get('one')).toMatchObject({
      text: 'New remote draft',
      attachments: [{ id: 'remote' }],
    });
    expect(controller.getSnapshot().records.one?.draft.text).toBe('New remote draft');
  } finally {
    title.resolve(session('one'));
    controller.dispose();
  }
});

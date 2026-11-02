/** @jest-environment node */
import { type ChatComposer, type ChatSession, type ChatTurn } from '@logto/schemas';

import { SessionApiError } from './session-api';
import { composer, deferred, session, setup, timestamp } from './session-controller.test-helper';

it('first_edit_creates_once_and_retries_same_id', async () => {
  const { api, controller } = setup();
  api.create.mockRejectedValueOnce(new Error('offline'));
  controller.setText('hello');
  await controller.flush();
  expect(controller.getSnapshot().emptyDraft.text).toBe('hello');
  await controller.flush();
  expect(api.create).toHaveBeenCalledTimes(2);
  expect(api.create.mock.calls[0]).toEqual(api.create.mock.calls[1]);
  expect(controller.getSnapshot().records.one?.draft.text).toBe('hello');
});

it('drafts_and_attachments_do_not_cross_sessions and reload_gets_server_composer', async () => {
  const { api, controller } = setup();
  api.composer.mockResolvedValueOnce(composer('stored'));
  await controller.openSession('one');
  controller.setText('private one');
  controller.addAttachments([{ id: 'file', name: 'notes.txt', text: 'notes' }]);
  await controller.openSession('two');
  expect(controller.getSnapshot().records.two?.draft.text).toBe('');
  expect(controller.getSnapshot().records.one?.draft.attachments).toHaveLength(1);
  controller.dispose();
});

it('late_save_does_not_overwrite_newer_typing', async () => {
  const { api, controller } = setup();
  await controller.openSession('one');
  const pending = deferred<ChatComposer>();
  api.saveComposer.mockImplementationOnce(async () => pending.promise);
  controller.setText('first');
  const save = controller.flush();
  controller.setText('newer');
  pending.resolve(composer('first', 1));
  await save;
  expect(controller.getSnapshot().records.one?.draft.text).toBe('newer');
  await controller.flush();
  expect(api.saveComposer).toHaveBeenLastCalledWith('one', {
    expectedRevision: 1,
    text: 'newer',
    attachments: [],
  });
  controller.dispose();
});

it('cross_device_conflict_preserves_local_draft until explicit resolution', async () => {
  const { api, controller } = setup();
  await controller.openSession('one');
  api.saveComposer.mockRejectedValueOnce(new SessionApiError('revision_conflict'));
  api.composer.mockResolvedValue(composer('other device', 3));
  controller.setText('local');
  await controller.flush();
  expect(controller.getSnapshot().records.one?.draft.text).toBe('local');
  expect(controller.getSnapshot().records.one?.conflict?.text).toBe('other device');
  await controller.resolveConflict('one', 'replace');
  expect(api.saveComposer).toHaveBeenLastCalledWith('one', {
    expectedRevision: 3,
    text: 'local',
    attachments: [],
  });
  controller.dispose();
});

it('closing_dirty_tab_keeps_failed_save_visible and only_tab_ids_enter_local_storage', async () => {
  const { api, controller, storage } = setup();
  await controller.openSession('one');
  controller.setText('secret text');
  api.saveComposer.mockRejectedValue(new Error('offline'));
  await controller.flush();
  controller.closeTab('one');
  expect(controller.getSnapshot().records.one?.saveState).toBe('failed');
  expect(JSON.stringify(storage.setItem.mock.calls)).not.toContain('secret text');
  expect(controller.getSnapshot().activeId).toBeUndefined();
  controller.dispose();
});

it('signout_discards_old_account_cache and rejects late responses', async () => {
  const { api, controller } = setup();
  const pending = deferred<ChatSession>();
  api.get.mockImplementation(async () => pending.promise);
  const open = controller.openSession('one');
  controller.dispose();
  pending.resolve(session('one'));
  await open;
  expect(controller.getSnapshot().records).toEqual({});
  expect(controller.getSnapshot().openIds).toEqual([]);
});

it('oversized attachments preserve accepted input without truncation', async () => {
  const { controller } = setup();
  await controller.openSession('one');
  controller.setText('keep');
  controller.addAttachments([{ id: 'large', name: 'large.txt', text: 'é'.repeat(60_000) }]);
  expect(controller.getSnapshot().records.one?.draft.text).toBe('keep');
  expect(controller.getSnapshot().records.one?.draft.attachments).toEqual([]);
  expect(controller.getSnapshot().error).toBe('content_limit');
  controller.dispose();
});

it('send captures the initiating session before awaiting composer persistence', async () => {
  const { api, controller } = setup();
  await controller.openSession('one');
  controller.setText('one prompt');
  const save = deferred<ChatComposer>();
  api.saveComposer.mockImplementationOnce(async () => save.promise);
  api.turn.mockResolvedValue({ state: 'completed', errorCode: null });
  const send = controller.send();
  await controller.openSession('two');
  save.resolve(composer('one prompt', 1));
  await send;
  expect(api.turn).toHaveBeenCalledWith('one', expect.objectContaining({ text: 'one prompt' }));
  expect(controller.getSnapshot().activeId).toBe('two');
  controller.dispose();
});

it('late_response_renders_only_in_original_session and disconnect never replays a turn', async () => {
  const { api, controller } = setup();
  await controller.openSession('one');
  controller.setText('prompt');
  const pending = deferred<ChatTurn>();
  const started = deferred<void>();
  api.turn.mockImplementation(async () => {
    started.resolve();
    return pending.promise;
  });
  const send = controller.send();
  await started.promise;
  await controller.openSession('two');
  pending.reject(new Error('disconnect'));
  api.getTurn.mockResolvedValue({ state: 'completed', errorCode: null });
  await send;
  expect(api.turn).toHaveBeenCalledTimes(1);
  expect(api.getTurn).toHaveBeenCalledWith('one', expect.any(String));
  expect(controller.getSnapshot().records.two?.turn).toBeUndefined();
  controller.dispose();
});

it('review ownership survives overlay closure and locks the whole session', async () => {
  const { controller } = setup();
  await controller.openSession('one');
  const pending = deferred<unknown>();
  const operation = controller.reviewOperation('one', async () => pending.promise);
  expect(controller.getSnapshot().records.one?.operation).toBe(true);
  controller.closeTab('one');
  await expect(controller.reviewOperation('one', async () => 'unexpected')).rejects.toThrow(
    'session_busy'
  );
  pending.resolve({});
  await operation;
  controller.dispose();
});

it('reload discovers running request identity from the server without replay', async () => {
  const { api, controller } = setup();
  const turn = {
    id: 'turn',
    requestId: '00000000-0000-4000-8000-000000000001',
    state: 'running' as const,
    errorCode: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    messageIds: ['user-message'],
  };
  api.latestTurn.mockResolvedValue(turn);
  await controller.openSession('one');
  expect(controller.getSnapshot().records.one).toMatchObject({
    running: true,
    requestId: turn.requestId,
  });
  expect(api.turn).not.toHaveBeenCalled();
  controller.dispose();
});

it('first meaningful text derives a title without using attachment contents', async () => {
  const { api, controller } = setup();
  controller.setText('A useful conversation title');
  await controller.flush();
  expect(api.update).toHaveBeenCalledWith('one', {
    expectedRevision: 0,
    title: 'A useful conversation title',
  });
  expect(controller.getSnapshot().history.map((item) => item.id)).toContain('one');
  controller.dispose();
});

it('an archived session can be explicitly restored without discarding an unsaved conflict', async () => {
  const { api, controller } = setup();
  await controller.openSession('one');
  controller.setText('keep this local draft');
  api.get.mockResolvedValueOnce({ ...session('one'), archivedAt: timestamp });
  await controller.refresh('one');
  await controller.change('one', { archived: false });
  expect(api.update).toHaveBeenCalledWith('one', { expectedRevision: 0, archived: false });
  expect(controller.getSnapshot().records.one?.draft.text).toBe('keep this local draft');
  controller.dispose();
});

it('a stale revalidation cannot release the in-flight owner of a newer request', async () => {
  const { api, controller } = setup();
  await controller.openSession('one');
  controller.setText('prompt');
  const pending = deferred<ChatTurn>();
  const started = deferred<void>();
  api.turn.mockImplementation(async () => {
    started.resolve();
    return pending.promise;
  });
  const send = controller.send();
  await started.promise;
  const requestId = controller.getSnapshot().records.one?.requestId;
  api.latestTurn.mockResolvedValue({
    id: 'old',
    requestId: '00000000-0000-4000-8000-000000000001',
    state: 'completed',
    errorCode: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: timestamp,
    messageIds: [],
  });
  await controller.refresh('one');
  expect(controller.getSnapshot().records.one).toMatchObject({ running: true, requestId });
  pending.resolve({
    id: 'new',
    requestId: requestId ?? '',
    state: 'completed',
    errorCode: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: timestamp,
    messageIds: [],
  });
  await send;
  controller.dispose();
});

it('late first-draft creation never selects or populates a different conversation', async () => {
  const { api, controller } = setup();
  const pending = deferred<ChatSession>();
  api.create.mockImplementationOnce(async () => pending.promise);
  controller.setText('Unbound private draft');
  const save = controller.flush();
  await controller.openSession('two');
  pending.resolve(session('created'));
  await save;
  expect(controller.getSnapshot().activeId).toBe('two');
  expect(controller.getSnapshot().records.created?.draft.text).toBe('Unbound private draft');
  expect(controller.getSnapshot().records.two?.draft.text).toBe('');
  controller.dispose();
});

it('disposed account controllers cannot start any new request from stale UI callbacks', async () => {
  const { api, controller } = setup();
  controller.dispose();
  await controller.newSession();
  await controller.list();
  await controller.openSession('one');
  await controller.send('old account text');
  expect(api.create).not.toHaveBeenCalled();
  expect(api.list).not.toHaveBeenCalled();
  expect(api.get).not.toHaveBeenCalled();
  expect(api.turn).not.toHaveBeenCalled();
});

it('interrupted turns restore visible error and require an explicit new prompt preparation, never replay', async () => {
  const { api, controller } = setup();
  api.latestTurn.mockResolvedValue({
    id: 'interrupted',
    requestId: '00000000-0000-4000-8000-000000000001',
    state: 'interrupted',
    errorCode: 'interrupted',
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: timestamp,
    messageIds: ['user'],
  });
  api.messages.mockResolvedValue({
    items: [
      {
        id: 'user',
        role: 'user',
        turnId: 'interrupted',
        content: 'Original prompt',
        sequence: 1,
        createdAt: timestamp,
        reviews: [],
      },
    ],
    nextCursor: null,
  });
  await controller.openSession('one');
  expect(controller.getSnapshot().records.one?.error).toBe('interrupted');
  expect(controller.getSnapshot().records.one?.draft.text).toBe('');
  controller.prepareRetry('one');
  expect(controller.getSnapshot().records.one?.draft.text).toBe('Original prompt');
  expect(api.turn).not.toHaveBeenCalled();
  controller.dispose();
});

it('focus revalidation preserves the selected title search and archive filter', async () => {
  const { api, controller } = setup();
  await controller.list(true, 'private title');
  await controller.list();
  expect(api.list).toHaveBeenLastCalledWith({ archived: true, search: 'private title' });
  controller.dispose();
});

it('Send captures click-time text while later typing survives a pending composer save', async () => {
  const { api, controller } = setup();
  await controller.openSession('one');
  controller.setText('Clicked prompt');
  const pending = deferred<ChatComposer>();
  api.saveComposer.mockImplementationOnce(async () => pending.promise);
  api.turn.mockResolvedValue({ state: 'completed', errorCode: null });
  const send = controller.send();
  controller.setText('Later unsent typing');
  pending.resolve(composer('Clicked prompt', 1));
  await send;
  expect(api.turn).toHaveBeenCalledWith(
    'one',
    expect.objectContaining({ text: 'Clicked prompt', composerRevision: 1 })
  );
  expect(controller.getSnapshot().records.one?.draft.text).toBe('Later unsent typing');
  controller.dispose();
});

it('first meaningful edit acquires its session immediately, before navigation or the save debounce', async () => {
  const { api, controller } = setup();
  controller.setText('Draft before navigation');
  expect(api.create).toHaveBeenCalledTimes(1);
  const creation = controller.newSession();
  await controller.openSession('two');
  const created = await creation;
  expect(created).toBe('one');
  await controller.flush('one');
  expect(controller.getSnapshot().activeId).toBe('two');
  expect(controller.getSnapshot().records.one?.draft.text).toBe('Draft before navigation');
  controller.dispose();
});

it('a late status-read failure cannot mark a newer request as failed', async () => {
  const { api, controller } = setup();
  await controller.openSession('one');
  controller.setText('First prompt');
  const first = deferred<ChatTurn>();
  const firstStarted = deferred<void>();
  api.turn.mockImplementationOnce(async () => {
    firstStarted.resolve();
    return first.promise;
  });
  const firstSend = controller.send();
  await firstStarted.promise;
  const stale = deferred<ChatTurn>();
  api.getTurn.mockImplementationOnce(async () => stale.promise);
  const poll = controller.poll();
  const completed: ChatTurn = {
    id: 'turn',
    requestId: '00000000-0000-4000-8000-000000000001',
    state: 'completed',
    errorCode: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: timestamp,
    messageIds: [],
  };
  first.resolve(completed);
  await firstSend;
  controller.setText('New prompt');
  const second = deferred<ChatTurn>();
  const secondStarted = deferred<void>();
  api.turn.mockImplementationOnce(async () => {
    secondStarted.resolve();
    return second.promise;
  });
  const secondSend = controller.send();
  await secondStarted.promise;
  stale.reject(new SessionApiError('not_found'));
  await poll;
  expect(controller.getSnapshot().records.one?.error).toBeUndefined();
  expect(controller.getSnapshot().records.one?.running).toBe(true);
  second.resolve(completed);
  await secondSend;
  controller.dispose();
});

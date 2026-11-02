import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import SessionFeedback from './SessionFeedback';
import { session, setup } from './session-controller.test-helper';

it('exposes explicit recovery of both drafts without executing an action or stale save', async () => {
  jest.useFakeTimers();
  const { api, controller } = setup();
  try {
    api.create.mockRejectedValueOnce(new Error('Response lost'));
    controller.setText('Original unsaved draft');
    await controller.newSession();
    await controller.openSession('one');
    controller.setText('Newer conversation draft');
    controller.addAttachments([{ id: 'new', name: 'new.txt', text: 'Newer file' }]);
    await controller.newSession();
    render(
      <SessionFeedback
        controller={controller}
        state={controller.getSnapshot()}
        search=""
        isArchived={false}
      />
    );
    expect(screen.getByRole('alert').textContent).toContain('both preserved');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Review existing conversation' }));
    });
    expect(controller.getSnapshot().emptyDraft.text).toBe('Original unsaved draft');
    expect(controller.getSnapshot().records.one?.draft.text).toBe('Newer conversation draft');
    expect(api.saveComposer).not.toHaveBeenCalled();

    api.create.mockResolvedValueOnce(session('recovered'));
    fireEvent.click(
      screen.getByRole('button', { name: 'Recover original draft in a new conversation' })
    );
    await waitFor(() => {
      expect(api.saveComposer).toHaveBeenCalledWith(
        'recovered',
        expect.objectContaining({ text: 'Original unsaved draft' })
      );
    });
    expect(controller.getSnapshot().records.one?.draft.attachments[0]?.text).toBe('Newer file');
    expect(api.saveComposer).not.toHaveBeenCalledWith('one', expect.anything());
    expect(api.turn).not.toHaveBeenCalled();
    expect(api.confirm).not.toHaveBeenCalled();
    expect(api.cancel).not.toHaveBeenCalled();
  } finally {
    controller.dispose();
    jest.useRealTimers();
  }
});

import { fireEvent, render, screen } from '@testing-library/react';

import SessionControls from './SessionControls';

const session = {
  id: 'one',
  title: 'A real chat',
  revision: 0,
  transcriptRevision: 0,
  archivedAt: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};
it('archive_restore_and_delete_require_explicit_controls and deletion confirmation', () => {
  const change = jest.fn();
  const remove = jest.fn();
  render(<SessionControls session={session} isBusy={false} onChange={change} onRemove={remove} />);
  expect(change).not.toHaveBeenCalled();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Conversation actions' }));
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete conversation…' }));
  expect(remove).not.toHaveBeenCalled();
  expect(screen.getByRole('alertdialog').textContent).toContain(
    'Action audit records, including action arguments and results, are retained separately.'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Delete conversation history' }));
  expect(remove).toHaveBeenCalledTimes(1);
});
it('delete_disabled_while_busy', () => {
  render(<SessionControls isBusy session={session} onChange={jest.fn()} onRemove={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Conversation actions' }));
  expect(screen.getByRole('menuitem', { name: 'Delete conversation…' })).toHaveProperty(
    'disabled',
    true
  );
  expect(screen.getByRole('menuitem', { name: 'Archive' })).toHaveProperty('disabled', true);
});

it('offers restore for archived conversations without replaying an action on opening', () => {
  const change = jest.fn();
  render(
    <SessionControls
      session={{ ...session, archivedAt: session.updatedAt }}
      isBusy={false}
      onChange={change}
      onRemove={jest.fn()}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Conversation actions' }));
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Restore' }));
  expect(change).toHaveBeenCalledTimes(1);
  expect(change).toHaveBeenCalledWith({ archived: false });
  expect(screen.queryByRole('menu')).toBeNull();
});

it('renames only the selected conversation after explicit submit, and cancel never deletes', () => {
  const change = jest.fn();
  const remove = jest.fn();
  const { rerender } = render(
    <SessionControls
      key="one"
      session={session}
      isBusy={false}
      onChange={change}
      onRemove={remove}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Conversation actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Rename…' }));
  const input = screen.getByRole('textbox', { name: 'Conversation title (120 characters)' });
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: 'Synthetic edited title' } });
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
  expect(change).toHaveBeenCalledWith({ title: 'Synthetic edited title' });
  rerender(
    <SessionControls
      key="two"
      session={{ ...session, id: 'two', title: 'Selected second conversation' }}
      isBusy={false}
      onChange={change}
      onRemove={remove}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Conversation actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Rename…' }));
  expect(screen.getByRole('textbox')).toHaveProperty('value', 'Selected second conversation');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Conversation actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete conversation…' }));
  fireEvent.click(screen.getByRole('button', { name: 'Keep conversation' }));
  expect(remove).not.toHaveBeenCalled();
  expect(change).toHaveBeenCalledTimes(1);
});

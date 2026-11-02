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
  fireEvent.click(screen.getByRole('button', { name: 'Delete conversation' }));
  expect(remove).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain(
    'Action audit records, including action arguments and results, are retained separately.'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Delete conversation history' }));
  expect(remove).toHaveBeenCalledTimes(1);
});
it('delete_disabled_while_busy', () => {
  render(<SessionControls isBusy session={session} onChange={jest.fn()} onRemove={jest.fn()} />);
  expect(screen.getByRole('button', { name: 'Delete conversation' })).toHaveProperty(
    'disabled',
    true
  );
  expect(screen.getByRole('button', { name: 'Archive' })).toHaveProperty('disabled', true);
});

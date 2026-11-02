import { fireEvent, render, screen } from '@testing-library/react';

import SessionTabs from './SessionTabs';

it('tab_close_does_not_archive_or_delete and keyboard selection moves focus', () => {
  const select = jest.fn();
  const close = jest.fn();
  render(
    <SessionTabs
      openSessions={[
        { id: 'one', title: 'First' },
        { id: 'two', title: 'Second' },
      ]}
      activeId="one"
      onSelect={select}
      onClose={close}
    />
  );
  fireEvent.keyDown(screen.getByRole('tab', { name: 'First' }), { key: 'End' });
  expect(select).toHaveBeenCalledWith('two');
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Second' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close First tab' }));
  expect(close).toHaveBeenCalledWith('one');
});

it('names running and draft-attention indicators without changing tab navigation', () => {
  render(
    <SessionTabs
      openSessions={[{ id: 'one', title: 'Synthetic review', running: true, attention: true }]}
      activeId="one"
      onSelect={jest.fn()}
      onClose={jest.fn()}
    />
  );
  expect(screen.getByRole('img', { name: 'Running' })).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Draft needs attention' })).toBeTruthy();
  expect(screen.getByRole('tab', { selected: true })).toBeTruthy();
});

import { type ChatSession } from '@logto/schemas';
import { fireEvent, render, screen } from '@testing-library/react';

import SessionSidebar from './SessionSidebar';

it('history_has_only_real_sessions and title-only search limits are visible', () => {
  const onSearch = jest.fn();
  const onOpen = jest.fn();
  render(
    <SessionSidebar
      sessions={[]}
      search=""
      isArchived={false}
      isLoading={false}
      onSearch={onSearch}
      onArchived={jest.fn()}
      onOpen={onOpen}
    />
  );
  expect(screen.getByText('No conversations yet')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'First conversation' })).toBeNull();
  fireEvent.change(
    screen.getByRole('searchbox', { name: 'Search conversation titles (120 characters)' }),
    { target: { value: 'landing' } }
  );
  expect(onSearch).toHaveBeenCalledWith('landing');
  expect(onOpen).not.toHaveBeenCalled();
});

it('keeps a synthetic long title accessible and its date beneath a current conversation', () => {
  const title = 'Synthetic workspace review '.repeat(12).trim();
  const session: ChatSession = {
    id: 'synthetic',
    title,
    updatedAt: '2026-11-02T12:00:00Z',
    createdAt: '2026-11-02T12:00:00Z',
    archivedAt: null,
    revision: 0,
    transcriptRevision: 0,
  };
  const onOpen = jest.fn();
  render(
    <SessionSidebar
      sessions={[session]}
      activeId="synthetic"
      search=""
      isArchived={false}
      isLoading={false}
      onSearch={jest.fn()}
      onArchived={jest.fn()}
      onOpen={onOpen}
    />
  );
  const row = screen.getByRole('button', { name: /Synthetic workspace review/ });
  expect(row.getAttribute('aria-current')).toBe('true');
  expect(screen.getByTitle(title).className).toBe('sessionTitle');
  expect(row.querySelector('time')?.getAttribute('datetime')).toBe('2026-11-02T12:00:00Z');
  fireEvent.click(row);
  expect(onOpen).toHaveBeenCalledWith('synthetic');
});

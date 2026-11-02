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
      onNew={jest.fn()}
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

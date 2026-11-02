import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { SidebarStateProvider, SidebarToggle, useSidebarState } from './SidebarState';

function Probe() {
  const { isCollapsed, expand } = useSidebarState();
  return (
    <button type="button" onClick={expand}>
      {isCollapsed ? 'Closed' : 'Open'}
    </button>
  );
}

describe('Shared shell sidebar state', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('shares heading state with the rail and persists without changing saved width', () => {
    window.localStorage.setItem('console-sidebar-width-v2', '360');
    render(
      <SidebarStateProvider>
        <SidebarToggle />
        <Probe />
      </SidebarStateProvider>
    );
    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(toggle.getAttribute('aria-controls')).toBe('console-sidebar');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Closed' })).toBeTruthy();
    expect(window.localStorage.getItem('console-sidebar-collapsed')).toBe('true');
    expect(window.localStorage.getItem('console-sidebar-width-v2')).toBe('360');
    fireEvent.click(screen.getByRole('button', { name: 'Closed' }));
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(window.localStorage.getItem('console-sidebar-collapsed')).toBe('false');
  });

  it('restores a collapsed rail', () => {
    window.localStorage.setItem('console-sidebar-collapsed', 'true');
    render(
      <SidebarStateProvider>
        <SidebarToggle />
        <Probe />
      </SidebarStateProvider>
    );
    expect(
      screen.getByRole('button', { name: 'Expand sidebar' }).getAttribute('aria-expanded')
    ).toBe('false');
  });

  it('keeps a desktop preference on mobile mount and transfers keyboard focus both ways', async () => {
    const width = jest.spyOn(window.screen, 'width', 'get').mockReturnValue(390);
    window.localStorage.setItem('console-sidebar-collapsed', 'false');
    render(
      <SidebarStateProvider>
        <SidebarToggle />
        <SidebarToggle isOverlay />
        <Probe />
      </SidebarStateProvider>
    );
    expect(window.localStorage.getItem('console-sidebar-collapsed')).toBe('false');
    const open = screen.getByRole('button', { name: 'Expand sidebar' });
    open.focus();
    fireEvent.click(open);
    const close = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(document.activeElement).toBe(close);
    expect(screen.queryByRole('button', { name: 'Expand sidebar' })).toBeNull();
    fireEvent.click(close);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Expand sidebar' }));
    });
    width.mockRestore();
  });

  it('works when storage is blocked', () => {
    const get = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Blocked');
    });
    const set = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Blocked');
    });
    render(
      <SidebarStateProvider>
        <SidebarToggle />
        <Probe />
      </SidebarStateProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.getByRole('button', { name: 'Closed' })).toBeTruthy();
    get.mockRestore();
    set.mockRestore();
  });
});

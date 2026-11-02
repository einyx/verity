import { fireEvent, render, screen } from '@testing-library/react';
import { createContext, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

import { TenantsContext } from '@/contexts/TenantsProvider';
import { type EnvTestUtils, mockEnv, resetMockEnv } from '@/test-utils/env';

import { SidebarStateProvider, SidebarToggle } from '../SidebarState';

import Sidebar from './index';

jest.mock('@/components/Topbar/TenantSelector', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/Topbar/AiChat', () => ({ __esModule: true, default: () => null }));

jest.mock('@/consts/env', () => jest.requireActual<EnvTestUtils>('@/test-utils/env').mockEnvModule);
jest.mock('@/hooks/use-admin-console-tour', () => ({ __esModule: true, default: jest.fn() }));

jest.mock('@/contexts/TenantsProvider', () => ({
  __esModule: true,
  TenantsContext: createContext({ currentTenantId: 'admin' }),
}));

jest.mock('@/ds-components/OverlayScrollbar', () => ({
  __esModule: true,
  default: ({ children }: { readonly children: ReactNode }) => <div>{children}</div>,
}));

jest.mock('@/hooks/use-theme', () => ({
  __esModule: true,
  default: () => 'light',
}));

jest.mock('./menu-icons', () => ({
  menuIcons: new Proxy(
    {},
    {
      get: () => () => <span />,
    }
  ),
}));

/** The console resolves relative links against the route they are rendered in. */
const currentPath = '/admin/infrastructure/new';

const renderSidebar = () =>
  render(
    <MemoryRouter initialEntries={[currentPath]}>
      <SidebarStateProvider>
        <SidebarToggle />
        <Sidebar />
      </SidebarStateProvider>
    </MemoryRouter>
  );

const getSidebarHrefs = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('a[href]'), (anchor) => anchor.getAttribute('href') ?? '');

describe('Console sidebar links', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockEnv({ isCloud: true, isDevFeaturesEnabled: true });
  });

  it('searches only permitted links and clearing restores the previous disclosures', () => {
    renderSidebar();
    const group = screen.getByRole('button', { name: 'admin_console.tab_sections.authentication' });
    fireEvent.click(group);
    const search = screen.getByRole('searchbox', { name: 'Search navigation' });
    fireEvent.change(search, { target: { value: 'landing_page' } });
    // Search reveals matching groups; don't offer a disclosure that cannot collapse them.
    expect(screen.queryByRole('button', { name: 'admin_console.tab_sections.tenant' })).toBeNull();
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toContain(
      '/admin/landing-page'
    );
    expect(screen.queryByRole('link', { name: 'admin_console.tabs.applications' })).toBeNull();
    fireEvent.change(search, { target: { value: 'stacks' } });
    expect(screen.getByRole('status').textContent).toContain('No pages found');
    fireEvent.click(screen.getByRole('button', { name: 'Clear navigation search' }));
    expect(group.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('link', { name: 'admin_console.tabs.applications' })).toBeTruthy();
  });

  it('expands and focuses search with Shift+CmdK without stealing CmdK', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(screen.queryByRole('searchbox')).toBeNull();
    fireEvent.keyDown(window, { key: 'K', metaKey: true, shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));
  });

  it('shows admin webhooks at the tenant-scoped route without restoring hidden navigation', () => {
    mockEnv({ isCloud: true, isProduction: true, isDevFeaturesEnabled: false });
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'admin_console.tab_sections.developer' }));
    expect(
      screen.getByRole('link', { name: 'admin_console.tabs.webhooks' }).getAttribute('href')
    ).toBe('/admin/webhooks');
    expect(screen.queryByRole('link', { name: 'admin_console.tabs.get_started' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'admin_console.tabs.customize_jwt' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'admin_console.tab_sections.infrastructure' })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'admin_console.tab_sections.authorization' })
    ).toBeNull();
  });

  it('preserves customer tenant webhook navigation and developer items', () => {
    render(
      <TenantsContext.Provider
        value={{ currentTenantId: 'customer' } as React.ContextType<typeof TenantsContext>}
      >
        <MemoryRouter initialEntries={['/customer/webhooks']}>
          <SidebarStateProvider>
            <Sidebar />
          </SidebarStateProvider>
        </MemoryRouter>
      </TenantsContext.Provider>
    );
    expect(
      screen.getByRole('link', { name: 'admin_console.tabs.webhooks' }).getAttribute('href')
    ).toBe('/customer/webhooks');
    expect(screen.getByRole('link', { name: 'admin_console.tabs.customize_jwt' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'admin_console.tabs.get_started' })).toBeTruthy();
  });

  it('preserves keyboard resizing and collapsed width across remounts', () => {
    const view = renderSidebar();
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' });
    expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('272');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    view.unmount();
    renderSidebar();
    expect(screen.queryByRole('separator')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('272');
  });

  afterEach(() => {
    resetMockEnv();
  });

  it('links to the tenant-scoped page instead of nesting under the current path', () => {
    const { container } = renderSidebar();
    const hrefs = getSidebarHrefs(container);

    expect(hrefs).toContain('/admin/dashboard');
    expect(hrefs).toContain('/admin/leads');
    expect(hrefs).toContain('/admin/landing-page');
    // No link may repeat the page that is currently open.
    expect(hrefs.filter((href) => href.startsWith(currentPath))).toEqual([]);
  });

  it('reveals the current group and marks a nested route as the current destination', () => {
    render(
      <MemoryRouter initialEntries={['/admin/applications/new']}>
        <SidebarStateProvider>
          <Sidebar />
        </SidebarStateProvider>
      </MemoryRouter>
    );
    expect(
      screen
        .getByRole('button', { name: 'admin_console.tab_sections.authentication' })
        .getAttribute('aria-expanded')
    ).toBe('true');
    expect(
      screen
        .getByRole('link', { name: 'admin_console.tabs.applications' })
        .getAttribute('aria-current')
    ).toBe('page');
  });

  it('shows the released landing-page editor for the Cloud admin tenant with dev features disabled', () => {
    mockEnv({ isCloud: true, isProduction: true, isDevFeaturesEnabled: false });
    const { container } = renderSidebar();
    expect(getSidebarHrefs(container)).toContain('/admin/landing-page');
  });

  it('keeps the landing-page editor hidden outside Cloud', () => {
    mockEnv({ isCloud: false, isProduction: true, isDevFeaturesEnabled: false });
    const { container } = renderSidebar();
    expect(getSidebarHrefs(container)).not.toContain('/admin/landing-page');
  });
});

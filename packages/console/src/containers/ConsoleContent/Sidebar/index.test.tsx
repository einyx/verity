import { render } from '@testing-library/react';
import { createContext, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

import { type EnvTestUtils, mockEnv, resetMockEnv } from '@/test-utils/env';

import Sidebar from './index';

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
      <Sidebar />
    </MemoryRouter>
  );

const getSidebarHrefs = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('a[href]'), (anchor) => anchor.getAttribute('href') ?? '');

describe('Console sidebar links', () => {
  beforeEach(() => {
    mockEnv({ isCloud: true, isDevFeaturesEnabled: true });
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
});

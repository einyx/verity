import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type * as React from 'react';
import { useCallback, useState } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';

import Sidebar from '@/containers/ConsoleContent/Sidebar';
import { SidebarStateProvider } from '@/containers/ConsoleContent/SidebarState';
import { TenantsContext } from '@/contexts/TenantsProvider';

import AiChat from './index';
import { deferred } from './session-controller.test-helper';

const mockList = jest.fn(async () => ({ items: [], nextCursor: null }));
const mockClaims = jest.fn(async () => ({ sub: 'synthetic-owner' }));
const mockSetLoading = jest.fn<void, [boolean]>();
const mockSetAuthenticated = jest.fn<void, [boolean]>();
const mockApi = { list: mockList };
jest.mock('@/components/LandingChat/demo-chat.css', () => ({}));
jest.mock('@/consts/env', () => ({ isCloud: true, isDevFeaturesEnabled: true }));
jest.mock('@/components/Topbar/TenantSelector', () => ({ __esModule: true, default: () => null }));
jest.mock('@/hooks/use-admin-console-tour', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/containers/ConsoleContent/Sidebar/OssCloudCard', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/containers/ConsoleContent/Sidebar/use-shell-navigation', () => ({
  __esModule: true,
  default: () => ({ sections: [] }),
}));
jest.mock('@/ds-components/OverlayScrollbar', () => ({
  __esModule: true,
  default: ({ children }: { readonly children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/contexts/TenantsProvider', () => {
  const { createContext } = jest.requireActual<typeof React>('react');
  return { TenantsContext: createContext({ currentTenantId: 'synthetic-tenant' }) };
});
jest.mock('@/hooks/use-api', () => ({ __esModule: true, default: () => mockApi }));
jest.mock('@/hooks/use-theme', () => ({ __esModule: true, default: () => 'light' }));
jest.mock('./session-api', () => ({ createSessionApi: () => mockApi }));
jest.mock('./use-landing-page-ai-headers', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('./LegacyAiChat', () => ({ __esModule: true, default: () => null }));
jest.mock('@logto/react', () => ({
  useLogto: () => {
    const [isLoading, setIsLoading] = useState(false);
    const [isAuthenticated, setIsAuthenticated] = useState(true);
    mockSetLoading.mockImplementation(setIsLoading);
    mockSetAuthenticated.mockImplementation(setIsAuthenticated);
    const getIdTokenClaims = useCallback(async () => {
      // The real SDK wraps claims reads in setIsLoading(true/false). Bound the
      // reproduction to its first call so the broken component cannot spin forever.
      if (mockClaims.mock.calls.length === 0) {
        setIsLoading(true);
        await new Promise((resolve) => {
          setTimeout(resolve, 0);
        });
        setIsLoading(false);
      }
      return mockClaims();
    }, []);
    return { isAuthenticated, isLoading, getIdTokenClaims };
  },
}));
jest.mock('./SessionWorkspaceRuntime', () => ({ __esModule: true, default: () => null }));

beforeEach(() => {
  mockClaims.mockClear();
  mockList.mockClear();
  window.localStorage.clear();
});

it('opens the real account workspace without repeating SDK claims initialization', async () => {
  render(<AiChat />);
  await waitFor(() => {
    expect(mockClaims).toHaveBeenCalled();
  });
  fireEvent.click(screen.getByRole('button', { name: 'admin_console.inkeep_ai_bot.ask_ai_label' }));
  await waitFor(() => {
    expect(mockList).toHaveBeenCalled();
  });
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(mockClaims).toHaveBeenCalledTimes(1);
});

it('keeps the opened workspace and account session load stable during unrelated SDK work', async () => {
  render(<AiChat />);
  await waitFor(() => {
    expect(mockClaims).toHaveBeenCalled();
  });
  fireEvent.click(screen.getByRole('button', { name: 'admin_console.inkeep_ai_bot.ask_ai_label' }));
  await waitFor(() => {
    expect(mockList).toHaveBeenCalled();
  });
  act(() => {
    mockSetLoading(true);
  });
  expect(screen.getByRole('dialog')).toBeTruthy();
  act(() => {
    mockSetLoading(false);
  });
  expect(screen.getByRole('dialog')).toBeTruthy();
});

it('still clears the private workspace immediately on sign-out', async () => {
  render(<AiChat />);
  await waitFor(() => {
    expect(mockClaims).toHaveBeenCalled();
  });
  fireEvent.click(screen.getByRole('button', { name: 'admin_console.inkeep_ai_bot.ask_ai_label' }));
  await waitFor(() => {
    expect(mockList).toHaveBeenCalled();
  });
  act(() => {
    mockSetAuthenticated(false);
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  mockList.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'admin_console.inkeep_ai_bot.ask_ai_label' }));
  expect(screen.getByRole('status').textContent).toBe(
    'Sign in to load your private conversations.'
  );
  expect(mockList).not.toHaveBeenCalled();
});

function CurrentRoute() {
  const { pathname } = useLocation();
  return <output aria-label="Current test route">{pathname}</output>;
}

it.each(['admin', 'customer'])(
  'opens the real sidebar assistant without changing the %s tenant route',
  async (tenantId) => {
    const path = `/${tenantId}/webhooks/synthetic/settings`;
    render(
      <TenantsContext.Provider
        value={{ currentTenantId: tenantId } as React.ContextType<typeof TenantsContext>}
      >
        <MemoryRouter initialEntries={[path]}>
          <SidebarStateProvider>
            <Sidebar />
          </SidebarStateProvider>
          <CurrentRoute />
        </MemoryRouter>
      </TenantsContext.Provider>
    );
    await waitFor(() => {
      expect(mockClaims).toHaveBeenCalled();
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'admin_console.inkeep_ai_bot.ask_ai_label' })
    );
    await waitFor(() => {
      expect(mockList).toHaveBeenCalled();
    });
    act(() => {
      mockSetLoading(true);
    });
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByLabelText('Current test route').textContent).toBe(path);
  }
);

it('ignores claims completing after logout and resolves a different signed-in account', async () => {
  const pending = deferred<{ sub: string }>();
  mockClaims.mockReturnValueOnce(pending.promise);
  render(<AiChat />);
  await waitFor(() => {
    expect(mockClaims).toHaveBeenCalledTimes(1);
  });
  act(() => {
    mockSetAuthenticated(false);
  });
  await act(async () => {
    pending.resolve({ sub: 'previous-owner' });
    await pending.promise;
  });
  fireEvent.click(screen.getByRole('button', { name: 'admin_console.inkeep_ai_bot.ask_ai_label' }));
  expect(screen.getByRole('status').textContent).toContain('Sign in');
  expect(mockList).not.toHaveBeenCalled();
  mockClaims.mockResolvedValueOnce({ sub: 'next-owner' });
  act(() => {
    mockSetAuthenticated(true);
  });
  await waitFor(() => {
    expect(mockClaims).toHaveBeenCalledTimes(2);
  });
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  fireEvent.click(screen.getByRole('button', { name: 'admin_console.inkeep_ai_bot.ask_ai_label' }));
  await waitFor(() => {
    expect(mockList).toHaveBeenCalled();
  });
});

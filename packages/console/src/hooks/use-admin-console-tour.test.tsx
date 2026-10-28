import { act, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import type * as React from 'react';

import { TenantsContext } from '@/contexts/TenantsProvider';

import useAdminConsoleTour from './use-admin-console-tour';
import useCurrentUser from './use-current-user';

jest.mock('./use-current-user', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/consts/env', () => ({ isCloud: true }));
jest.mock('@/contexts/TenantsProvider', () => {
  const { createContext } = jest.requireActual<typeof React>('react');
  return { TenantsContext: createContext({ currentTenantId: 'admin' }) };
});
jest.mock('driver.js/dist/driver.css', () => ({}));

const updateCustomData = jest.fn().mockResolvedValue(undefined);

function Fixture({ hasEditor = true }: { readonly hasEditor?: boolean }) {
  useAdminConsoleTour();
  return (
    <>
      <a href="/sign-in-experience" data-tour="sign_in_experience">
        Sign-in
      </a>
      {hasEditor && (
        <a href="/landing-page" data-tour="landing_page">
          Editor
        </a>
      )}
      <a href="/leads" data-tour="leads">
        Leads
      </a>
    </>
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.mocked(useCurrentUser).mockReturnValue({
    user: { id: 'operator' },
    isLoaded: true,
    customData: {},
    updateCustomData,
  } as unknown as ReturnType<typeof useCurrentUser>);
  // JSDOM has no layout/scrolling; the actual driver still renders and handles the tour.
  // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- Polyfill the DOM API missing from JSDOM.
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: jest.fn(),
  });
  // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- Polyfill the DOM API missing from JSDOM.
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn().mockReturnValue({ matches: true }),
  });
});

afterEach(() => {
  jest.useRealTimers();
});

function clickButton(name: string) {
  fireEvent.click(screen.getByRole('button', { name: `admin_console.admin_console_tour.${name}` }));
  act(() => {
    jest.advanceTimersByTime(500);
  });
}

it('shows the three sidebar highlights without following links and remembers completion', () => {
  render(<Fixture />);
  expect(screen.getByText('admin_console.admin_console_tour.welcome.title')).toBeTruthy();
  clickButton('next');
  expect(document.querySelector('.driver-active-element')?.getAttribute('href')).toBe(
    '/sign-in-experience'
  );
  clickButton('next');
  expect(document.querySelector('.driver-active-element')?.getAttribute('href')).toBe(
    '/landing-page'
  );
  clickButton('next');
  expect(document.querySelector('.driver-active-element')?.getAttribute('href')).toBe('/leads');
  clickButton('done');
  expect(updateCustomData).toHaveBeenCalledWith({ consoleTourDone: true });
  expect(document.querySelector('.driver-popover')).toBeNull();
});

it('omits unavailable editor targets and remembers dismissal', () => {
  render(<Fixture hasEditor={false} />);
  clickButton('next');
  clickButton('next');
  expect(document.querySelector('.driver-active-element')?.getAttribute('href')).toBe('/leads');
  clickButton('close');
  expect(updateCustomData).toHaveBeenCalledWith({ consoleTourDone: true });
});

it('does not show again for a user who already dismissed the tour', () => {
  jest.mocked(useCurrentUser).mockReturnValue({
    user: { id: 'operator' },
    isLoaded: true,
    customData: { consoleTourDone: true },
    updateCustomData,
  } as unknown as ReturnType<typeof useCurrentUser>);
  render(<Fixture />);
  expect(document.querySelector('.driver-popover')).toBeNull();
});

it('does not persist completion when the sidebar unmounts', () => {
  const { unmount } = render(<Fixture />);
  unmount();
  expect(updateCustomData).not.toHaveBeenCalled();
  expect(document.querySelector('.driver-popover')).toBeNull();
});

it('does not run in customer tenants', () => {
  render(
    <TenantsContext.Provider
      value={{ currentTenantId: 'customer' } as React.ContextType<typeof TenantsContext>}
    >
      <Fixture />
    </TenantsContext.Provider>
  );
  expect(document.querySelector('.driver-popover')).toBeNull();
});

it('waits until the user profile is loaded', () => {
  jest.mocked(useCurrentUser).mockReturnValue({
    isLoaded: false,
    customData: {},
    updateCustomData,
  } as unknown as ReturnType<typeof useCurrentUser>);
  render(<Fixture />);
  expect(document.querySelector('.driver-popover')).toBeNull();
});

it('survives Strict Mode cleanup without saving a dismissal', () => {
  render(
    <StrictMode>
      <Fixture />
    </StrictMode>
  );
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(updateCustomData).not.toHaveBeenCalled();
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, useContext } from 'react';

import {
  mockAccountCenterSettings,
  mockSignInExperienceSettings,
} from '@ac/__mocks__/RenderWithPageContext';
import { getAccountCenterSettings } from '@ac/apis/account-center';
import { getSignInExperienceSettings } from '@ac/apis/sign-in-experience';
import { changeLanguage } from '@ac/i18n/utils';

import PageContextProvider from '.';
import PageContext from './PageContext';

jest.mock('@logto/react', () => ({ useLogto: () => ({ isAuthenticated: false }) }));
jest.mock('@ac/hooks/use-api', () => ({ __esModule: true, default: () => jest.fn() }));
jest.mock('@ac/apis/account-center', () => ({ getAccountCenterSettings: jest.fn() }));
jest.mock('@ac/apis/sign-in-experience', () => ({ getSignInExperienceSettings: jest.fn() }));
jest.mock('@ac/i18n/utils', () => ({
  changeLanguage: jest.fn(),
  getPreferredLanguage: () => 'en',
}));

const accountRequest = jest.mocked(getAccountCenterSettings);
const experienceRequest = jest.mocked(getSignInExperienceSettings);

const SettingsProbe = () => {
  const {
    isLoadingExperience,
    experienceError,
    accountCenterSettings,
    experienceSettings,
    reloadSettings,
  } = useContext(PageContext);
  return (
    <>
      <div data-testid="state">
        {isLoadingExperience ? 'pending' : experienceError ? 'error' : 'ready'}
      </div>
      <div data-testid="settings">
        {JSON.stringify({ accountCenterSettings, experienceSettings })}
      </div>
      <button
        onClick={() => {
          void reloadSettings();
        }}
      >
        Retry
      </button>
    </>
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  experienceRequest.mockResolvedValue(mockSignInExperienceSettings);
  accountRequest.mockResolvedValue(mockAccountCenterSettings);
});

it('exposes a load failure until explicit retry, then retains the configured fields and policies', async () => {
  accountRequest.mockRejectedValueOnce(new Error('offline'));
  render(
    <PageContextProvider>
      <SettingsProbe />
    </PageContextProvider>
  );
  await waitFor(() => {
    expect(screen.getByTestId('state').textContent).toBe('error');
  });
  expect(accountRequest).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => {
    expect(screen.getByTestId('state').textContent).toBe('ready');
  });
  expect(accountRequest).toHaveBeenCalledTimes(2);
  expect(JSON.parse(screen.getByTestId('settings').textContent)).toEqual({
    accountCenterSettings: mockAccountCenterSettings,
    experienceSettings: mockSignInExperienceSettings,
  });
});

it('deduplicates retries while pending and preserves previously loaded settings on failure', async () => {
  render(
    <PageContextProvider>
      <SettingsProbe />
    </PageContextProvider>
  );
  await waitFor(() => {
    expect(screen.getByTestId('state').textContent).toBe('ready');
  });
  const previous = screen.getByTestId('settings').textContent;
  const rejectRequest = jest.fn<void, [Error]>();
  const pending = new Promise<typeof mockAccountCenterSettings>((_resolve, reject) => {
    rejectRequest.mockImplementation(reject);
  });
  accountRequest.mockReturnValueOnce(pending);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(screen.getByTestId('state').textContent).toBe('pending');
  expect(accountRequest).toHaveBeenCalledTimes(2);
  rejectRequest(new Error('offline'));
  await waitFor(() => {
    expect(screen.getByTestId('state').textContent).toBe('error');
  });
  expect(screen.getByTestId('settings').textContent).toBe(previous);
  expect(accountRequest).toHaveBeenCalledTimes(2);
});

it('requires another explicit retry after a repeated failure and recovers from language loading errors', async () => {
  jest.mocked(changeLanguage).mockRejectedValueOnce(new Error('language unavailable'));
  accountRequest.mockResolvedValue({ ...mockAccountCenterSettings, enabled: false });
  render(
    <PageContextProvider>
      <SettingsProbe />
    </PageContextProvider>
  );
  await waitFor(() => {
    expect(screen.getByTestId('state').textContent).toBe('error');
  });
  accountRequest.mockRejectedValueOnce(new Error('still offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => {
    expect(screen.getByTestId('state').textContent).toBe('error');
  });
  expect(accountRequest).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => {
    expect(screen.getByTestId('state').textContent).toBe('ready');
  });
  expect(screen.getByTestId('settings').textContent).toContain('"enabled":false');
  expect(accountRequest).toHaveBeenCalledTimes(3);
});

it('settles one settings request across StrictMode effect replay', async () => {
  render(
    <StrictMode>
      <PageContextProvider>
        <SettingsProbe />
      </PageContextProvider>
    </StrictMode>
  );
  await waitFor(() => {
    expect(screen.getByTestId('state').textContent).toBe('ready');
  });
  expect(accountRequest).toHaveBeenCalledTimes(1);
});

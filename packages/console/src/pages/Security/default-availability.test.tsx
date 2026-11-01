import { CaptchaType, type CaptchaProvider } from '@logto/schemas';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type * as React from 'react';

import { ReadOnlyFieldContext } from '@/contexts/ReadOnlyFieldScope';
import useApi from '@/hooks/use-api';
import useCurrentTenantScopes from '@/hooks/use-current-tenant-scopes';
import usePaywall from '@/hooks/use-paywall';
import useUserPreferences from '@/hooks/use-user-preferences';

import CaptchaForm from './Captcha/CaptchaForm';
import GeneralForm from './General/GeneralForm';
import { generalFormParser } from './General/use-data-fetch';
import PaywallNotification from './PaywallNotification';

const mockPatch = jest.fn();
const mockUpdate = jest.fn();

jest.mock('@/consts', () => ({ sentinel: 'https://docs.meshx.io/sentinel' }));
jest.mock('@/components/ContactUsPhraseLink', () => ({ __esModule: true, default: () => null }));

jest.mock('@/utils/form', () => ({
  trySubmitSafe: (callback: (...args: unknown[]) => Promise<void>) => callback,
}));

jest.mock('@/hooks/use-api', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/hooks/use-paywall', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/hooks/use-current-tenant-scopes', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/hooks/use-user-preferences', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/hooks/use-tenant-pathname', () => ({
  __esModule: true,
  default: () => ({ navigate: jest.fn() }),
}));
jest.mock('swr', () => ({ useSWRConfig: () => ({ mutate: jest.fn() }) }));
jest.mock('react-hot-toast', () => ({ toast: { success: jest.fn() } }));
jest.mock('@/contexts/SubscriptionDataProvider', () => {
  const { createContext } = jest.requireActual<typeof React>('react');
  return {
    SubscriptionDataContext: createContext({ mutateSubscriptionQuotaAndUsages: jest.fn() }),
  };
});
jest.mock('@/components/UnsavedChangesAlertModal', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('./General/SentinelUnlockModal', () => ({ __esModule: true, default: () => null }));
jest.mock('./Captcha/CreateCaptchaForm', () => ({
  __esModule: true,
  default: ({ isOpen }: { readonly isOpen: boolean }) =>
    isOpen ? <div>Provider setup</div> : null,
}));
jest.mock('./Captcha/CaptchaCard', () => ({
  __esModule: true,
  default: () => <div>Configured provider</div>,
}));
jest.mock('@/components/FeatureTag', () => ({
  CombinedAddOnAndFeatureTag: () => <span>Pro required</span>,
  addOnLabels: { addOnBundle: 'addOnBundle' },
}));
jest.mock('@/components/FormCard', () => ({
  __esModule: true,
  default: ({
    children,
    tag,
  }: {
    readonly children: React.ReactNode;
    readonly tag?: React.ReactNode;
  }) => (
    <section>
      {tag}
      {children}
    </section>
  ),
}));
jest.mock('@/ds-components/FormField', () => ({
  __esModule: true,
  default: ({ children }: { readonly children: React.ReactNode }) => <div>{children}</div>,
}));

const formData = {
  sentinelPolicyEnabled: false,
  sentinelPolicy: { maxAttempts: 7, lockoutDuration: 89 },
  verificationCodePolicyEnabled: false,
  verificationCodePolicy: { maxRetryAttempts: 9, expirationDuration: 123 },
};
const captchaProvider: CaptchaProvider = {
  id: 'provider',
  tenantId: 'tenant',
  createdAt: 1,
  updatedAt: 1,
  config: { type: CaptchaType.Turnstile, siteKey: 'site', secretKey: 'secret' },
};

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(usePaywall)
    .mockReturnValue({ isFreeTenant: true, isPaidTenant: false } as ReturnType<typeof usePaywall>);
  jest
    .mocked(useCurrentTenantScopes)
    .mockReturnValue({ access: { isReadOnly: false } } as ReturnType<
      typeof useCurrentTenantScopes
    >);
  jest.mocked(useUserPreferences).mockReturnValue({
    data: { securityFeaturesUpsellNoticeAcknowledged: false },
    update: mockUpdate,
  } as unknown as ReturnType<typeof useUserPreferences>);
  jest.mocked(useApi).mockReturnValue({ patch: mockPatch } as unknown as ReturnType<typeof useApi>);
});

describe('General security availability', () => {
  it('allows Free admins to enable lockout explicitly, preserving policy values when saving', async () => {
    mockPatch.mockReturnValue({
      json: async () =>
        generalFormParser.toSignInExperience({ ...formData, sentinelPolicyEnabled: true }),
    });
    render(<GeneralForm formData={formData} />);
    const lockout = screen.getAllByRole('checkbox')[0] as HTMLInputElement;
    expect(lockout.disabled).toBe(false);
    expect(lockout.checked).toBe(false);
    expect(mockPatch).not.toHaveBeenCalled();
    expect(screen.queryByText('Pro required')).toBeNull();
    fireEvent.click(lockout);
    fireEvent.click(screen.getByText('admin_console.general.save_changes'));
    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('api/sign-in-exp', {
        json: { sentinelPolicy: formData.sentinelPolicy, verificationCodePolicy: {} },
      });
    });
  });

  it('keeps lockout disabled for read-only members and never autosaves', () => {
    jest
      .mocked(useCurrentTenantScopes)
      .mockReturnValue({ access: { isReadOnly: true } } as ReturnType<
        typeof useCurrentTenantScopes
      >);
    render(<GeneralForm formData={formData} />);
    expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByText('admin_console.general.save_changes')).toBeNull();
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('retains stored enabled policy values within the existing read-only field scope', () => {
    jest
      .mocked(useCurrentTenantScopes)
      .mockReturnValue({ access: { isReadOnly: true } } as ReturnType<
        typeof useCurrentTenantScopes
      >);
    render(
      <ReadOnlyFieldContext.Provider value>
        <GeneralForm formData={{ ...formData, sentinelPolicyEnabled: true }} />
      </ReadOnlyFieldContext.Provider>
    );
    expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).checked).toBe(true);
    const inputs = screen.getAllByRole<HTMLInputElement>('spinbutton');
    expect(inputs.map(({ value }) => value)).toEqual(['7', '89']);
    expect(inputs.every(({ readOnly }) => readOnly)).toBe(true);
    expect(
      screen.queryByText(
        'admin_console.security.sentinel_policy.manual_unlock.unblock_by_identifiers'
      )
    ).toBeNull();
    expect(mockPatch).not.toHaveBeenCalled();
  });
});

describe('CAPTCHA availability', () => {
  it('allows Free admins to add a provider but cannot enable CAPTCHA without one', () => {
    render(<CaptchaForm formData={{ enabled: false }} />);
    const add = screen
      .getByText('admin_console.security.bot_protection.captcha.add')
      .closest('button');
    expect(add?.disabled).toBe(false);
    const toggle = screen.getByRole<HTMLInputElement>('checkbox');
    expect(toggle.disabled).toBe(true);
    expect(toggle.checked).toBe(false);
    expect(screen.queryByText('Pro required')).toBeNull();
    expect(mockPatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('admin_console.security.bot_protection.captcha.add'));
    expect(screen.getByText('Provider setup')).toBeTruthy();
  });

  it('shows an existing provider for Free admins without changing the disabled policy on mount', async () => {
    mockPatch.mockReturnValue({ json: async () => ({ captchaPolicy: { enabled: true } }) });
    render(<CaptchaForm captchaProvider={captchaProvider} formData={{ enabled: false }} />);
    expect(screen.getByText('Configured provider')).toBeTruthy();
    expect(screen.queryByText('admin_console.security.bot_protection.captcha.add')).toBeNull();
    const toggle = screen.getByRole<HTMLInputElement>('checkbox');
    expect(toggle.disabled).toBe(false);
    expect(toggle.checked).toBe(false);
    expect(mockPatch).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByText('admin_console.general.save_changes'));
    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('api/sign-in-exp', {
        json: { captchaPolicy: { enabled: true } },
      });
    });
  });

  it('keeps a configured provider visible but forbids read-only policy edits', () => {
    jest
      .mocked(useCurrentTenantScopes)
      .mockReturnValue({ access: { isReadOnly: true } } as ReturnType<
        typeof useCurrentTenantScopes
      >);
    render(<CaptchaForm captchaProvider={captchaProvider} formData={{ enabled: true }} />);
    expect(screen.getByText('Configured provider')).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>('checkbox').disabled).toBe(true);
    expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(true);
    expect(screen.queryByText('admin_console.general.save_changes')).toBeNull();
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('does not offer provider creation to read-only members', () => {
    jest
      .mocked(useCurrentTenantScopes)
      .mockReturnValue({ access: { isReadOnly: true } } as ReturnType<
        typeof useCurrentTenantScopes
      >);
    render(<CaptchaForm formData={{ enabled: false }} />);
    expect(screen.queryByText('admin_console.security.bot_protection.captcha.add')).toBeNull();
    expect(screen.getByRole<HTMLInputElement>('checkbox').disabled).toBe(true);
    expect(mockPatch).not.toHaveBeenCalled();
  });
});

describe('Security notice', () => {
  it('does not show a Free upgrade notice or change preferences on mount', () => {
    const { container } = render(<PaywallNotification />);
    expect(container.textContent).toBe('');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('retains paid add-on disclosure and only acknowledges it on request', async () => {
    jest
      .mocked(usePaywall)
      .mockReturnValue({ isFreeTenant: false, isPaidTenant: true } as ReturnType<
        typeof usePaywall
      >);
    render(<PaywallNotification />);
    expect(
      screen.getByText('admin_console.upsell.add_on.security_features_inline_notification')
    ).toBeTruthy();
    expect(mockUpdate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('admin_console.general.got_it'));
    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith({ securityFeaturesUpsellNoticeAcknowledged: true });
    });
  });

  it('hides the existing paid notice once acknowledged', () => {
    jest
      .mocked(usePaywall)
      .mockReturnValue({ isFreeTenant: false, isPaidTenant: true } as ReturnType<
        typeof usePaywall
      >);
    jest.mocked(useUserPreferences).mockReturnValue({
      data: { securityFeaturesUpsellNoticeAcknowledged: true },
      update: mockUpdate,
    } as unknown as ReturnType<typeof useUserPreferences>);
    const { container } = render(<PaywallNotification />);
    expect(container.textContent).toBe('');
  });
});

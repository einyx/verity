import { generateDarkColor } from '@logto/core-kit';

import type { CreateSignInExperience } from '../db-entries/index.js';
import { SignInMode } from '../db-entries/index.js';
import {
  MfaFactor,
  MfaPolicy,
  OrganizationRequiredMfaPolicy,
  SignInIdentifier,
} from '../foundations/index.js';

import { adminTenantId, defaultTenantId } from './tenant.js';

export const defaultPrimaryColor = '#6139F6';

/** The MeshX brand accent, used as the admin tenant's default primary colour. */
const meshxPrimaryColor = '#FE330A';
/** MeshX wordmarks served by the console build (`packages/console/public`). */
const consoleOrigin = process.env.CONSOLE_ORIGIN ?? 'https://console.example.com';
const meshxLogoUrl = `${consoleOrigin}/console/meshx-logo.svg`;
const meshxDarkLogoUrl = `${consoleOrigin}/console/meshx-logo-dark.svg`;

export const createDefaultSignInExperience = (
  forTenantId: string,
  isCloud: boolean
): Readonly<CreateSignInExperience> =>
  Object.freeze({
    tenantId: forTenantId,
    id: 'default',
    color: {
      primaryColor: defaultPrimaryColor,
      isDarkModeEnabled: false,
      darkPrimaryColor: generateDarkColor(defaultPrimaryColor),
    },
    branding: {
      logoUrl: isCloud ? undefined : 'https://logto.io/logo.svg',
      darkLogoUrl: isCloud ? undefined : 'https://logto.io/logo-dark.svg',
    },
    hideLogtoBranding: false,
    languageInfo: {
      autoDetect: true,
      fallbackLanguage: 'en' as const,
    },
    termsOfUseUrl: null,
    privacyPolicyUrl: null,
    signUp: {
      identifiers: [isCloud ? SignInIdentifier.Email : SignInIdentifier.Username],
      password: true,
      verify: isCloud,
    },
    signIn: {
      methods: [
        {
          identifier: isCloud ? SignInIdentifier.Email : SignInIdentifier.Username,
          password: true,
          verificationCode: false,
          isPasswordPrimary: true,
        },
      ],
    },
    socialSignInConnectorTargets: [],
    signInMode: SignInMode.SignInAndRegister,
    customCss: null,
    customContent: {},
    customUiAssets: null,
    signUpProfileFields: null,
    passwordPolicy: {},
    mfa: {
      factors: [],
      policy: MfaPolicy.UserControlled,
    },
  });

/** @deprecated Use `createDefaultSignInExperience()` instead. */
export const defaultSignInExperience = createDefaultSignInExperience(defaultTenantId, false);

export type AdminSignInExperienceSeedOptions = {
  /**
   * When true, the seeded admin-tenant `passwordPolicy` explicitly disables the
   * HaveIBeenPwned (HIBP) breach check by setting `rejects.pwned = false`. Intended
   * for air-gapped or offline OSS deployments where `api.pwnedpasswords.com` is
   * unreachable; otherwise the first admin sign-up will hang on the breach check.
   *
   * Defaults to `false`, which preserves the historical seeded value (`{}`) and lets
   * the runtime fall back to the default policy (HIBP check enabled).
   */
  disablePwnedPasswordCheck?: boolean;
};

export const createAdminTenantSignInExperience = (
  options: AdminSignInExperienceSeedOptions = {}
): Readonly<CreateSignInExperience> =>
  Object.freeze({
    ...defaultSignInExperience,
    tenantId: adminTenantId,
    color: {
      primaryColor: meshxPrimaryColor,
      isDarkModeEnabled: true,
      darkPrimaryColor: generateDarkColor(meshxPrimaryColor),
    },
    signInMode: SignInMode.Register,
    branding: {
      logoUrl: meshxLogoUrl,
      darkLogoUrl: meshxDarkLogoUrl,
    },
    passwordPolicy: options.disablePwnedPasswordCheck
      ? {
          ...defaultSignInExperience.passwordPolicy,
          rejects: {
            ...defaultSignInExperience.passwordPolicy?.rejects,
            pwned: false,
          },
        }
      : defaultSignInExperience.passwordPolicy,
    mfa: {
      factors: [MfaFactor.TOTP, MfaFactor.WebAuthn, MfaFactor.BackupCode],
      policy: MfaPolicy.NoPrompt,
      organizationRequiredMfaPolicy: OrganizationRequiredMfaPolicy.Mandatory,
    },
  });

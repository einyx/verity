import { yes } from '@silverhand/essentials';

import { storageKeys } from './storage';

const normalizeEnv = (value: unknown) =>
  value === null || value === undefined ? undefined : String(value);

export const isProduction = import.meta.env.PROD;
export const isCloud = yes(normalizeEnv(import.meta.env.IS_CLOUD));
export const isProtectedAppLocalDevEnabled =
  !isProduction && yes(normalizeEnv(import.meta.env.PROTECTED_APP_LOCAL_DEV));
export const isProtectedAppEnabled = isCloud || isProtectedAppLocalDevEnabled;
export const adminEndpoint = normalizeEnv(import.meta.env.ADMIN_ENDPOINT);

export const isDevFeaturesEnabled =
  !isProduction ||
  yes(normalizeEnv(import.meta.env.DEV_FEATURES_ENABLED)) ||
  yes(localStorage.getItem(storageKeys.isDevFeaturesEnabled));

// eslint-disable-next-line import/no-unused-modules
export const consoleEmbeddedPricingUrl =
  normalizeEnv(import.meta.env.CONSOLE_EMBEDDED_PRICING_URL) ??
  'https://logto.io/console-embedded-pricing';

export const ossSurveyEndpoint = normalizeEnv(import.meta.env.LOGTO_OSS_SURVEY_ENDPOINT);

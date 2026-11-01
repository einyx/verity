import i18next from 'i18next';

import initI18n from './init';

jest.mock('i18next', () => {
  const actual = jest.requireActual<{ createInstance: () => typeof i18next }>('i18next');
  return actual.createInstance();
});

it('provides readable error and retry labels before remote settings or phrases can load', async () => {
  await initI18n();
  expect(i18next.t('error.something_went_wrong')).toBe('Something went wrong');
  expect(i18next.t('account_center.security.trusted_devices.retry')).toBe('Try again');
  i18next.addResourceBundle(
    'en',
    'translation',
    { error: { something_went_wrong: 'Custom error' } },
    true,
    true
  );
  expect(i18next.t('error.something_went_wrong')).toBe('Custom error');
});

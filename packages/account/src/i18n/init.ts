import resource from '@logto/phrases-experience';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

i18next.use(initReactI18next);

/**
 * Initialize with a bundled fallback so settings/phrase failures remain readable.
 * Remote phrases are loaded once in PageContextProvider via changeLanguage().
 */
const initI18n = async () => {
  if (i18next.isInitialized) {
    return;
  }

  await i18next.init({
    // Phrase exports are frozen; i18next must own a mutable copy for remote overrides.
    resources: { en: structuredClone(resource.en) },
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });
};

export default initI18n;

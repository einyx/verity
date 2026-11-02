import i18next from 'i18next';
import ky from 'ky';
import { createRoot } from 'react-dom/client';
import { initReactI18next } from 'react-i18next';
import '../../../src/scss/normalized.scss';

import PersistentAiChat from '../../../src/components/Topbar/AiChat/PersistentAiChat';
import { createSessionApi } from '../../../src/components/Topbar/AiChat/session-api';
import theme from '../../../src/contexts/AppThemeProvider/index.module.scss';

await i18next
  .use(initReactI18next)
  .init({ lng: 'en', resources: { en: { translation: {} } }, react: { useSuspense: false } });
document.documentElement.classList.add(theme.light ?? '');
const userId = new URLSearchParams(location.search).get('owner') ?? 'browser-owner';
const api = createSessionApi(
  ky.create({ prefixUrl: location.origin, headers: { 'x-test-owner': userId } }),
  async () => ({})
);
const app = document.querySelector('#app');
if (!app) {
  throw new Error('Missing test root');
}
createRoot(app).render(<PersistentAiChat api={api} scope={{ tenantId: 'tenant-a', userId }} />);

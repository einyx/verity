import i18next from 'i18next';
import { createRoot } from 'react-dom/client';
import { initReactI18next } from 'react-i18next';

import AiChat from '../../../src/components/Topbar/AiChat';
import theme from '../../../src/contexts/AppThemeProvider/index.module.scss';

await i18next.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: {} } },
  react: { useSuspense: false },
});
document.documentElement.classList.add(
  theme[new URLSearchParams(location.search).get('theme') ?? 'light'] ?? ''
);
const app = document.querySelector('#app');
if (!app) {
  throw new Error('Missing synthetic chat root');
}
createRoot(app).render(<AiChat />);

import { Theme } from '@logto/schemas';
import i18next from 'i18next';
import { createRoot } from 'react-dom/client';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import '../../../src/scss/normalized.scss';

import topbar from '../../../src/components/Topbar/index.module.scss';
import Sidebar from '../../../src/containers/ConsoleContent/Sidebar';
import {
  SidebarStateProvider,
  SidebarToggle,
} from '../../../src/containers/ConsoleContent/SidebarState';
import styles from '../../../src/containers/ConsoleContent/index.module.scss';
import themeStyles from '../../../src/contexts/AppThemeProvider/index.module.scss';

const theme =
  new URLSearchParams(location.search).get('theme') === 'dark' ? Theme.Dark : Theme.Light;
document.documentElement.classList.add(themeStyles[theme] ?? '');

function Fixture() {
  return (
    <MemoryRouter initialEntries={['/synthetic/dashboard']}>
      <SidebarStateProvider>
        <div style={{ height: '100dvh', display: 'flex', fontFamily: '"Stack Sans", sans-serif' }}>
          <div className={`${styles.content} ${theme === Theme.Dark ? styles.dark : ''}`}>
            <Sidebar />
            <div className={styles.workspace}>
              <header className={`${topbar.topbar} ${topbar.workspace}`}>
                <SidebarToggle />
                <nav aria-label="Current page" className={styles.breadcrumb}>
                  <span>Overview</span>
                  <strong aria-current="page">Dashboard</strong>
                </nav>
              </header>
              <div className={styles.overlayScrollbarWrapper}>
                <main className={styles.main}>
                  <h1>Synthetic workspace</h1>
                  <p>Local shell review — no account data or remote requests.</p>
                  <button type="button">Synthetic content action</button>
                </main>
              </div>
            </div>
          </div>
        </div>
      </SidebarStateProvider>
    </MemoryRouter>
  );
}

const app = document.querySelector('#app');
if (app) {
  await i18next.use(initReactI18next).init({
    lng: 'en',
    resources: { en: { translation: { admin_console: { tabs: { dashboard: 'Dashboard' } } } } },
  });
  createRoot(app).render(<Fixture />);
}

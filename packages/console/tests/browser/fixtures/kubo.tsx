import i18next from 'i18next';
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom';
import { SWRConfig } from 'swr';

import theme from '../../../src/contexts/AppThemeProvider/index.module.scss';
import Kubo from '../../../src/pages/Kubo';
import Agent from '../../../src/pages/Kubo/Agent';
import Bundle from '../../../src/pages/Kubo/Bundle';
import Capacity from '../../../src/pages/Kubo/Capacity';
import KuboAccess from '../../../src/pages/Kubo/KuboAccess';
import Wizard from '../../../src/pages/Kubo/KuboWizard';
import Stack from '../../../src/pages/Kubo/Stack';

import { FixtureActor, TenantsContext } from './kubo-boundaries';

await i18next
  .use(initReactI18next)
  .init({ lng: 'en', resources: { en: { translation: {} } }, react: { useSuspense: false } });
document.documentElement.classList.add(theme.light ?? '');
function Fixture() {
  const [tenant, setTenant] = useState('a');
  const [actor, setActor] = useState('ordinary');
  const tenantContext = useMemo(() => ({ currentTenantId: tenant }), [tenant]);
  return (
    <FixtureActor.Provider value={actor}>
      <TenantsContext.Provider value={tenantContext}>
        <SWRConfig value={{ dedupingInterval: 0, shouldRetryOnError: false }}>
          <MemoryRouter initialEntries={['/infrastructure']}>
            <label>
              Fixture tenant
              <select
                value={tenant}
                onChange={(event) => {
                  setTenant(event.target.value);
                }}
              >
                <option>a</option>
                <option>b</option>
              </select>
            </label>
            <label>
              Fixture actor
              <select
                value={actor}
                onChange={(event) => {
                  setActor(event.target.value);
                }}
              >
                <option>ordinary</option>
                <option>operator</option>
                <option>readonly</option>
              </select>
            </label>
            <nav>
              {['', '/new', '/stacks/team/product', '/agent', '/capacity', '/bundle'].map(
                (suffix) => (
                  <Link key={suffix} to={`/infrastructure${suffix}`}>
                    {suffix || 'overview'}
                  </Link>
                )
              )}
            </nav>
            <KuboAccess>
              <Routes>
                <Route path="/infrastructure" element={<Kubo />} />
                <Route path="/infrastructure/new" element={<Wizard />} />
                <Route path="/infrastructure/stacks/:namespace/:name" element={<Stack />} />
                <Route path="/infrastructure/agent" element={<Agent />} />
                <Route path="/infrastructure/capacity" element={<Capacity />} />
                <Route path="/infrastructure/bundle" element={<Bundle />} />
              </Routes>
            </KuboAccess>
          </MemoryRouter>
        </SWRConfig>
      </TenantsContext.Provider>
    </FixtureActor.Provider>
  );
}
const root = document.querySelector('#app');
if (!root) {
  throw new Error('Missing owned Kubo fixture root');
}
createRoot(root).render(<Fixture />);

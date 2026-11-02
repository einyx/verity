import { defaultLandingPageContent } from '@logto/schemas';
import i18next from 'i18next';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';

import ProposedActionCard from '../../../src/components/Topbar/AiChat/ProposedActionCard';

await i18next.init({ lng: 'en', resources: {} });
const document = {
  ...defaultLandingPageContent,
  sections: defaultLandingPageContent.sections.map((section) =>
    section.type === 'hero'
      ? {
          ...section,
          headline: ['Govern financial data with confidence'],
          lede: 'A synthetic bank-call introduction',
        }
      : section
  ),
};
const root = window.document.querySelector('#root');
if (!root) {
  throw new Error('Missing owned artifact fixture root');
}
function Fixture() {
  const [status, setStatus] = useState<'pending' | 'running'>('pending');
  return (
    <I18nextProvider i18n={i18next}>
      <ProposedActionCard
        action={{
          id: 'synthetic-review',
          tool: 'save_landing_page_draft',
          body: document,
          status,
          expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        }}
        onConfirm={() => {
          if (new URLSearchParams(window.location.search).has('mockSave')) {
            setStatus('running');
            return;
          }
          throw new Error('This test must not save');
        }}
        onCancel={() => {
          throw new Error('This test must not discard');
        }}
      />
    </I18nextProvider>
  );
}
createRoot(root).render(<Fixture />);

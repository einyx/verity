import { defaultLandingPageContent } from '@logto/schemas';
import i18next from 'i18next';
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
createRoot(root).render(
  <I18nextProvider i18n={i18next}>
    <ProposedActionCard
      action={{
        id: 'synthetic-review',
        tool: 'save_landing_page_draft',
        body: document,
        status: 'pending',
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      }}
      onConfirm={() => {
        throw new Error('This test must not save');
      }}
      onCancel={() => {
        throw new Error('This test must not discard');
      }}
    />
  </I18nextProvider>
);

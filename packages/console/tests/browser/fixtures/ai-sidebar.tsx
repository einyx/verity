import { type ChatSession } from '@logto/schemas';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../src/scss/normalized.scss';

import AiWorkspace from '../../../src/components/Topbar/AiChat/AiWorkspace';
import SessionSidebar from '../../../src/components/Topbar/AiChat/SessionSidebar';
import SessionTabs from '../../../src/components/Topbar/AiChat/SessionTabs';
import theme from '../../../src/contexts/AppThemeProvider/index.module.scss';

const parameters = new URLSearchParams(location.search);
document.documentElement.classList.add(
  theme[parameters.get('theme') === 'dark' ? 'dark' : 'light'] ?? ''
);
document.documentElement.setAttribute('dir', parameters.has('rtl') ? 'rtl' : 'ltr');
const sessions: ChatSession[] = Array.from({ length: 40 }, (_, index) => ({
  id: `synthetic-${index}`,
  title:
    index === 0
      ? 'SyntheticWorkspaceReview'.repeat(12)
      : `Synthetic workspace ${index} — مراجعة 工作区`,
  createdAt: '2026-11-02T12:00:00Z',
  updatedAt: '2026-11-02T12:00:00Z',
  archivedAt: null,
  revision: 0,
  transcriptRevision: 0,
}));

function Fixture() {
  const [activeId, setActiveId] = useState('synthetic-0');
  const [isArchived, setIsArchived] = useState(false);
  return (
    <div style={{ height: '100dvh' }}>
      <AiWorkspace
        hasMessages={false}
        isLoading={false}
        composer={null}
        thread={null}
        setup={null}
        tabs={
          <SessionTabs
            openSessions={sessions.slice(1, 3)}
            activeId={activeId}
            onSelect={setActiveId}
            onClose={() => null}
          />
        }
        history={
          <SessionSidebar
            sessions={parameters.has('empty') ? [] : sessions}
            activeId={activeId}
            search=""
            isArchived={isArchived}
            isLoading={parameters.has('loading')}
            onSearch={() => null}
            onArchived={setIsArchived}
            onNew={() => null}
            onOpen={setActiveId}
          />
        }
        onPromptSelected={() => null}
        onClose={() => null}
      />
    </div>
  );
}

const app = document.querySelector('#app');
if (app) {
  createRoot(app).render(<Fixture />);
}

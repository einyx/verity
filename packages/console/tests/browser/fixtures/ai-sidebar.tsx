import { type ChatSession } from '@logto/schemas';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../src/scss/normalized.scss';

import AiWorkspace from '../../../src/components/Topbar/AiChat/AiWorkspace';
import SessionControls from '../../../src/components/Topbar/AiChat/SessionControls';
import SessionSidebar from '../../../src/components/Topbar/AiChat/SessionSidebar';
import SessionTabs from '../../../src/components/Topbar/AiChat/SessionTabs';
import theme from '../../../src/contexts/AppThemeProvider/index.module.scss';

/**
 * Synthetic topbar AI workspace fixture for the browser suite.
 *
 * Every conversation, tab, draft and action result lives in this component's local state. There is
 * no network, provider or API access, and rendering never creates a session: the AiWorkspace `onNew`
 * control is click-driven only. The persistent left rail is gone on purpose, so history renders in
 * the temporary AiWorkspace dialog through the `(dismiss) => ReactNode` render function.
 *
 * URL parameters switch variants: `theme=dark`, `empty`, `loading`, `archived-active`.
 */

const parameters = new URLSearchParams(location.search);
document.documentElement.classList.add(
  theme[parameters.get('theme') === 'dark' ? 'dark' : 'light'] ?? ''
);

const stamp = (minute: number) => new Date(Date.UTC(2026, 10, 2, 9, minute)).toISOString();

const session = (id: string, title: string, minute: number, archivedAt?: string): ChatSession => ({
  id,
  title,
  archivedAt: archivedAt ?? null,
  createdAt: stamp(0),
  updatedAt: stamp(minute),
  revision: 0,
  transcriptRevision: 0,
});

const recentSessions: ChatSession[] = [
  session(
    'synthetic-0',
    'Synthetic workspace review with an exceptionally long title that must clamp after two lines',
    0
  ),
  session('synthetic-1', 'Sign-in investigation notes', 1),
  session('synthetic-2', 'Landing page polish review', 2),
  session(
    'synthetic-3',
    'Synthetic budget summary with an extended descriptive title for tab strip overflow',
    3
  ),
  session(
    'synthetic-4',
    'Synthetic onboarding checklist with an extended descriptive title for tab strip overflow',
    4
  ),
  session(
    'synthetic-5',
    'Synthetic deployment notes with an extended descriptive title for tab strip overflow',
    5
  ),
  ...Array.from({ length: 10 }, (_, index) =>
    session(`synthetic-${index + 6}`, `Synthetic conversation ${index + 6}`, index + 6)
  ),
];

const archivedSessions: ChatSession[] = [
  session('synthetic-a0', 'Synthetic archived brainstorm sweep', 20, stamp(20)),
  session('synthetic-a1', 'Sign-in audit archive', 21, stamp(21)),
  session('synthetic-a2', 'Synthetic archived retrospective', 22, stamp(22)),
];

const isEmpty = parameters.has('empty');
const initialSessions = isEmpty ? [] : [...recentSessions, ...archivedSessions];
const initialActiveId = isEmpty
  ? undefined
  : parameters.has('archived-active')
    ? 'synthetic-a0'
    : 'synthetic-0';
const initialOpenIds = isEmpty
  ? []
  : parameters.has('archived-active')
    ? ['synthetic-a0', 'synthetic-1']
    : recentSessions.slice(0, 6).map(({ id }) => id);

function Fixture() {
  const [sessions, setSessions] = useState(initialSessions);
  const [activeId, setActiveId] = useState<string | undefined>(initialActiveId);
  const [openIds, setOpenIds] = useState<string[]>(initialOpenIds);
  const [search, setSearch] = useState('');
  const [isArchived, setIsArchived] = useState(false);
  const [draft, setDraft] = useState('');
  // Paired with SessionControls onOpenChange so AiWorkspace can aria-hide/inert the main section
  // while the actions dialog is open (keeps the react-modal nested aria-hidden counters balanced).
  const [actionsOpen, setActionsOpen] = useState(false);
  const [activity, setActivity] = useState({ created: 0, changed: 0, removed: 0 });

  const active = sessions.find(({ id }) => id === activeId);
  // The production controller filters server-side per Recent/Archived bucket; the fixture mirrors
  // that contract locally.
  const visible = sessions
    .filter(({ archivedAt }) => Boolean(archivedAt) === isArchived)
    .filter(({ title }) => title.toLowerCase().includes(search.trim().toLowerCase()));
  const openSessions = openIds.flatMap((id) => {
    const record = sessions.find(({ id: sessionId }) => sessionId === id);
    return record ? [{ id, title: record.title }] : [];
  });

  return (
    <div
      style={{ height: '100dvh' }}
      data-new-chat-count={activity.created}
      data-changed-count={activity.changed}
      data-removed-count={activity.removed}
    >
      <AiWorkspace
        hasMessages={false}
        isLoading={false}
        composer={
          <form
            className="demo-chat-form"
            onSubmit={(event) => {
              event.preventDefault();
            }}
          >
            <textarea
              aria-label="Message"
              className="demo-chat-input"
              placeholder="Drafts stay inside this synthetic fixture"
              value={draft}
              onChange={(event) => {
                setDraft(event.currentTarget.value);
              }}
            />
            <div className="demo-chat-toolbar">
              <p className="demo-chat-hint">Synthetic send — nothing reaches a provider.</p>
              <button type="submit" className="demo-chat-send">
                Send
              </button>
            </div>
          </form>
        }
        thread={null}
        setup={null}
        history={(dismiss) => (
          <SessionSidebar
            sessions={visible}
            activeId={activeId}
            search={search}
            isArchived={isArchived}
            isLoading={parameters.has('loading')}
            onSearch={setSearch}
            onArchived={setIsArchived}
            onOpen={(id) => {
              setActiveId(id);
              setOpenIds((current) => (current.includes(id) ? current : [...current, id]));
              dismiss();
            }}
          />
        )}
        tabs={
          <SessionTabs
            openSessions={openSessions}
            activeId={activeId}
            onSelect={setActiveId}
            onClose={(id) => {
              const remaining = openIds.filter((tabId) => tabId !== id);
              setOpenIds(remaining);
              if (activeId === id) {
                setActiveId(remaining[0]);
              }
            }}
          />
        }
        title={
          active && (
            <SessionControls
              key={active.id}
              session={active}
              isBusy={false}
              onOpenChange={setActionsOpen}
              onChange={(input) => {
                setSessions((current) =>
                  current.map((item) =>
                    item.id === active.id
                      ? {
                          ...item,
                          title: input.title ?? item.title,
                          archivedAt:
                            input.archived === undefined
                              ? item.archivedAt
                              : input.archived
                                ? stamp(40)
                                : null,
                        }
                      : item
                  )
                );
                setActivity((current) => ({ ...current, changed: current.changed + 1 }));
              }}
              onRemove={() => {
                const remainingTabs = openIds.filter((tabId) => tabId !== active.id);
                setSessions((current) => current.filter((item) => item.id !== active.id));
                setOpenIds(remainingTabs);
                if (activeId === active.id) {
                  setActiveId(remainingTabs[0]);
                }
                setActivity((current) => ({ ...current, removed: current.removed + 1 }));
              }}
            />
          )
        }
        panelId={activeId ? `chat-panel-${activeId}` : undefined}
        panelLabelId={activeId ? `chat-tab-${activeId}` : undefined}
        isActionsOpen={actionsOpen}
        onNew={() => {
          const id = `synthetic-new-${activity.created}`;
          const fresh = session(id, `Fresh synthetic chat ${activity.created + 1}`, 30);
          setSessions((current) => [fresh, ...current]);
          setOpenIds((current) => [id, ...current]);
          setActiveId(id);
          setActivity((current) => ({ ...current, created: current.created + 1 }));
        }}
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

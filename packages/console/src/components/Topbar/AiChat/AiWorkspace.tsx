import { type ReactNode, useEffect, useRef, useState } from 'react';

import CloseIcon from '@/assets/icons/close.svg?react';
import CubeIcon from '@/assets/icons/cube.svg?react';
import EditIcon from '@/assets/icons/edit.svg?react';
import SearchIcon from '@/assets/icons/search.svg?react';

import styles from './workspace.module.scss';

const tasks = [
  {
    label: 'Review workspace templates',
    rail: 'Workspaces',
    icon: <CubeIcon />,
    prompt:
      'Compare Foundation, Dashboards AI, Foundation AI, and V1 workspace templates. Do not create anything yet.',
  },
  {
    label: 'Investigate sign-in issues',
    rail: 'Investigate sign-ins',
    icon: <SearchIcon />,
    prompt: 'Review recent sign-in audit logs and help me understand any failures.',
  },
  {
    label: 'Improve the landing page',
    rail: 'Landing page',
    icon: <EditIcon />,
    prompt:
      'Review the landing page and suggest an improvement for me to preview. Do not save or publish anything.',
  },
];

function MeshMark() {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M7 7l18 18M25 7L7 25" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path
        d="M16 3v26M3 16h26"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity=".45"
      />
    </svg>
  );
}

export default function AiWorkspace({
  hasMessages,
  isLoading,
  composer,
  thread,
  setup,
  onPromptSelected,
  onClose,
  history,
  tabs,
  title,
  panelId,
  panelLabelId,
}: {
  readonly hasMessages: boolean;
  readonly isLoading: boolean;
  readonly composer: ReactNode;
  readonly thread: ReactNode;
  readonly setup: ReactNode;
  readonly onPromptSelected: (prompt: string) => void;
  readonly onClose: () => void;
  readonly history?: ReactNode;
  readonly tabs?: ReactNode;
  readonly title?: ReactNode;
  readonly panelId?: string;
  readonly panelLabelId?: string;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyTrigger = useRef<HTMLButtonElement>(null);
  const historyRail = useRef<HTMLElement>(null);
  useEffect(() => {
    const rail = historyRail.current;
    if (!rail || !historyOpen) {
      return;
    }
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setHistoryOpen(false);
        historyTrigger.current?.focus();
      }
    };
    rail.addEventListener('keydown', dismiss);
    rail.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      rail.removeEventListener('keydown', dismiss);
    };
  }, [historyOpen]);
  return (
    <div className={styles.workspace} data-has-messages={hasMessages}>
      <aside
        ref={historyRail}
        id="chat-history"
        className={styles.rail}
        data-open={historyOpen}
        aria-label={history ? 'Ask AI history' : 'Ask AI tasks'}
      >
        <div className={styles.brand}>
          <MeshMark />
          <span>meshX</span>
          <span className={styles.aiLabel}>AI workspace</span>
        </div>
        {history}
        {historyOpen && (
          <button
            type="button"
            className={styles.close}
            onClick={() => {
              setHistoryOpen(false);
              historyTrigger.current?.focus();
            }}
          >
            Close history
          </button>
        )}
        {!history && (
          <div className={styles.currentSession}>
            <span aria-hidden="true">✧</span> Ask meshX
          </div>
        )}
        <div className={styles.explore}>
          <p className={styles.railLabel}>Explore your console</p>
          {tasks.map((task) => (
            <button
              key={task.rail}
              type="button"
              className={styles.railTask}
              disabled={isLoading}
              onClick={() => {
                onPromptSelected(task.prompt);
              }}
            >
              <span className={styles.railTaskIcon} aria-hidden="true">
                {task.icon}
              </span>
              <span>{task.rail}</span>
            </button>
          ))}
        </div>
        <div className={styles.railNote}>
          <p>Your console, in conversation.</p>
          <p>Review proposals before allowing changes.</p>
        </div>
        <div className={styles.setup}>{setup}</div>
      </aside>
      <section className={styles.main} aria-label="Ask meshX conversation">
        <header className={styles.header}>
          {history && (
            <button
              ref={historyTrigger}
              type="button"
              className={styles.historyToggle}
              aria-expanded={historyOpen}
              aria-controls="chat-history"
              onClick={() => {
                setHistoryOpen((open) => !open);
              }}
            >
              History
            </button>
          )}
          <span>Ask meshX</span>
          <button
            type="button"
            className={styles.close}
            aria-label="Close Ask AI"
            onClick={onClose}
          >
            <CloseIcon aria-hidden="true" />
            <span>Close</span>
            <kbd>Esc</kbd>
          </button>
        </header>
        {tabs}
        {title}
        <div
          className={styles.body}
          id={panelId}
          role={panelId ? 'tabpanel' : undefined}
          aria-labelledby={panelLabelId}
        >
          <div className={styles.welcome} hidden={hasMessages}>
            <h1>
              <MeshMark />
              <span>What shall we work on?</span>
            </h1>
            <p>Investigate, build, and refine—with you in control.</p>
          </div>
          <div className={styles.transcript} hidden={!hasMessages}>
            {hasMessages ? thread : null}
          </div>
          <div className={styles.composer}>{composer}</div>
          <div className={styles.suggestions} hidden={hasMessages}>
            <p>Ideas for your workspace</p>
            {tasks.map((task) => (
              <button
                key={task.label}
                type="button"
                className={styles.suggestion}
                disabled={isLoading}
                onClick={() => {
                  onPromptSelected(task.prompt);
                }}
              >
                <span className={styles.taskIcon} aria-hidden="true">
                  {task.icon}
                </span>
                <span>{task.label}</span>
                <span className={styles.arrow} aria-hidden="true">
                  ↗
                </span>
              </button>
            ))}
          </div>
          <p className={styles.disclaimer}>
            AI can make mistakes. Review changes before confirming.
          </p>
        </div>
      </section>
    </div>
  );
}

import { type ReactNode, useRef, useState } from 'react';
import Modal from 'react-modal';

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
  onNew,
  isActionsOpen = false,
}: {
  readonly hasMessages: boolean;
  readonly isLoading: boolean;
  readonly composer: ReactNode;
  readonly thread: ReactNode;
  readonly setup: ReactNode;
  readonly onPromptSelected: (prompt: string) => void;
  readonly onClose: () => void;
  readonly history?: ReactNode | ((dismiss: () => void) => ReactNode);
  readonly tabs?: ReactNode;
  readonly title?: ReactNode;
  readonly panelId?: string;
  readonly panelLabelId?: string;
  readonly onNew?: () => void;
  readonly isActionsOpen?: boolean;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyTrigger = useRef<HTMLButtonElement>(null);
  const dismissHistory = () => {
    setHistoryOpen(false);
  };
  return (
    <div className={styles.workspace} data-has-messages={hasMessages}>
      <section
        data-ai-workspace-main
        className={styles.main}
        aria-label="Ask meshX conversation"
        aria-hidden={historyOpen || isActionsOpen || undefined}
        inert={historyOpen || isActionsOpen}
      >
        <header className={styles.header}>
          <span className={styles.workspaceTitle}>Ask meshX</span>
          {onNew && (
            <button type="button" className={styles.close} onClick={onNew}>
              New chat
            </button>
          )}
          {history && (
            <button
              ref={historyTrigger}
              type="button"
              className={styles.close}
              aria-haspopup="dialog"
              aria-expanded={historyOpen}
              aria-controls="chat-history"
              onClick={() => {
                setHistoryOpen((open) => !open);
              }}
            >
              History
            </button>
          )}
          {title}
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
        <Modal
          shouldCloseOnOverlayClick
          isOpen={historyOpen}
          contentLabel="Conversation history"
          id="chat-history"
          ariaHideApp={false}
          className={styles.historyDialog}
          overlayClassName={styles.historyOverlay}
          onAfterClose={() => {
            historyTrigger.current?.focus();
          }}
          onRequestClose={(event) => {
            event.stopPropagation();
            dismissHistory();
          }}
        >
          <div className={styles.historyHeading}>
            <h2>Conversation history</h2>
            <button type="button" className={styles.close} onClick={dismissHistory}>
              Close history
            </button>
          </div>
          {typeof history === 'function' ? history(dismissHistory) : history}
        </Modal>
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
          <div className={styles.setup}>{setup}</div>
        </div>
      </section>
    </div>
  );
}

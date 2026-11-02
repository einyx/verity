import { useRef } from 'react';

import styles from './workspace.module.scss';

export default function SessionTabs({
  openSessions,
  activeId,
  onSelect,
  onClose,
}: {
  readonly openSessions: Array<{
    id: string;
    title: string;
    attention?: boolean;
    running?: boolean;
  }>;
  readonly activeId?: string;
  readonly onSelect: (id: string) => void;
  readonly onClose: (id: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const select = (index: number) => {
    const session = openSessions[index];
    if (!session) {
      return;
    }
    onSelect(session.id);
    root.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus();
  };
  return (
    <div ref={root} className={styles.tabs} role="tablist" aria-label="Open conversations">
      {openSessions.map((session, index) => (
        <div key={session.id} role="presentation" className={styles.tab}>
          <button
            type="button"
            role="tab"
            aria-selected={session.id === activeId}
            tabIndex={session.id === activeId ? 0 : -1}
            id={`chat-tab-${session.id}`}
            aria-controls={`chat-panel-${session.id}`}
            onClick={() => {
              onSelect(session.id);
            }}
            onKeyDown={(event) => {
              const target =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? openSessions.length - 1
                    : event.key === 'ArrowRight'
                      ? (index + 1) % openSessions.length
                      : event.key === 'ArrowLeft'
                        ? (index + openSessions.length - 1) % openSessions.length
                        : undefined;
              if (target !== undefined) {
                event.preventDefault();
                select(target);
              }
            }}
          >
            {session.title}
            {session.running && <span aria-label="Running"> ···</span>}
            {session.attention && <span aria-label="Draft needs attention"> !</span>}
          </button>
          <button
            type="button"
            aria-label={`Close ${session.title} tab`}
            onClick={() => {
              onClose(session.id);
              const next = openSessions[index + 1] ?? openSessions[index - 1];
              if (next) {
                root.current
                  ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                  [openSessions.indexOf(next)]?.focus();
              }
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

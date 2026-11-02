import { type ChatSession, type SessionPage } from '@logto/schemas';

import styles from './workspace.module.scss';

export default function SessionSidebar({
  sessions,
  activeId,
  search,
  isArchived,
  isLoading,
  nextCursor,
  onSearch,
  onArchived,
  onOpen,
  onMore,
}: {
  readonly sessions: ChatSession[];
  readonly activeId?: string;
  readonly search: string;
  readonly isArchived: boolean;
  readonly isLoading: boolean;
  readonly nextCursor?: SessionPage<ChatSession>['nextCursor'];
  readonly onSearch: (value: string) => void;
  readonly onArchived: (value: boolean) => void;
  readonly onOpen: (id: string) => void;
  readonly onMore?: () => void;
}) {
  return (
    <nav className={styles.history} aria-label="Conversation history">
      <label className={styles.railLabel} htmlFor="chat-history-search">
        Search conversation titles (120 characters)
      </label>
      <input
        id="chat-history-search"
        type="search"
        value={search}
        onChange={(event) => {
          const { value } = event.currentTarget;
          if ([...value].length <= 120) {
            onSearch(value);
          }
        }}
      />
      <div className={styles.filters}>
        <button
          type="button"
          aria-pressed={!isArchived}
          onClick={() => {
            onArchived(false);
          }}
        >
          Recent
        </button>
        <button
          type="button"
          aria-pressed={isArchived}
          onClick={() => {
            onArchived(true);
          }}
        >
          Archived
        </button>
      </div>
      {isLoading && <p role="status">Loading conversations…</p>}
      {!isLoading && sessions.length === 0 && <p>No conversations yet</p>}
      {/* Keyboard users can focus the scroll viewport independently of opening a conversation. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <ul className={styles.sessionList} tabIndex={0} aria-label="Conversations">
        {sessions.map((session) => (
          <li key={session.id}>
            <button
              type="button"
              className={styles.sessionRow}
              aria-current={session.id === activeId ? 'true' : undefined}
              onClick={() => {
                onOpen(session.id);
              }}
            >
              <span className={styles.sessionTitle} title={session.title}>
                {session.title}
              </span>
              <time dateTime={session.updatedAt}>
                {new Date(session.updatedAt).toLocaleDateString()}
              </time>
            </button>
          </li>
        ))}
      </ul>
      {nextCursor && (
        <button type="button" className={styles.close} disabled={isLoading} onClick={onMore}>
          More conversations
        </button>
      )}
    </nav>
  );
}

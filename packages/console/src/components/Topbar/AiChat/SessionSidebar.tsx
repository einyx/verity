import { type ChatSession, type SessionPage } from '@logto/schemas';

import styles from './workspace.module.scss';

export default function SessionSidebar({
  sessions,
  search,
  isArchived,
  isLoading,
  nextCursor,
  onSearch,
  onArchived,
  onNew,
  onOpen,
  onMore,
}: {
  readonly sessions: ChatSession[];
  readonly search: string;
  readonly isArchived: boolean;
  readonly isLoading: boolean;
  readonly nextCursor?: SessionPage<ChatSession>['nextCursor'];
  readonly onSearch: (value: string) => void;
  readonly onArchived: (value: boolean) => void;
  readonly onNew: () => void;
  readonly onOpen: (id: string) => void;
  readonly onMore?: () => void;
}) {
  return (
    <nav className={styles.history} aria-label="Conversation history">
      <button type="button" className={styles.close} onClick={onNew}>
        New chat
      </button>
      <label className={styles.railLabel} htmlFor="chat-history-search">
        Search titles · 120 characters
      </label>
      <input
        id="chat-history-search"
        type="search"
        aria-label="Search conversation titles (120 characters)"
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
      <ul>
        {sessions.map((session) => (
          <li key={session.id}>
            <button
              type="button"
              className={styles.railTask}
              onClick={() => {
                onOpen(session.id);
              }}
            >
              <span>{session.title}</span>
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

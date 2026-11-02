import { type ChatSession, chatTitleGuard } from '@logto/schemas';
import { useState } from 'react';

import styles from './workspace.module.scss';

export default function SessionControls({
  session,
  isBusy,
  onChange,
  onRemove,
}: {
  readonly session: ChatSession;
  readonly isBusy: boolean;
  readonly onChange: (input: { title?: string; archived?: boolean }) => void;
  readonly onRemove: () => void;
}) {
  const [editedTitle, setEditedTitle] = useState<string>();
  const title = editedTitle ?? session.title;
  const [deleting, setDeleting] = useState(false);
  const valid = chatTitleGuard.safeParse(title).success;
  return (
    <div className={styles.lifecycle}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) {
            onChange({ title });
          }
        }}
      >
        <label htmlFor={`chat-title-${session.id}`}>Conversation title (120 characters)</label>
        <input
          id={`chat-title-${session.id}`}
          value={title}
          disabled={isBusy || Boolean(session.archivedAt)}
          aria-invalid={!valid}
          onChange={(event) => {
            setEditedTitle(event.currentTarget.value);
          }}
        />
        <button
          type="submit"
          disabled={isBusy || Boolean(session.archivedAt) || !valid || title === session.title}
        >
          Rename
        </button>
      </form>
      <button
        type="button"
        disabled={isBusy}
        onClick={() => {
          onChange({ archived: !session.archivedAt });
        }}
      >
        {session.archivedAt ? 'Restore' : 'Archive'}
      </button>
      <button
        type="button"
        disabled={isBusy}
        onClick={() => {
          setDeleting(true);
        }}
      >
        Delete conversation
      </button>
      {deleting && (
        <div role="alert" className={styles.deleteWarning}>
          <p>
            Delete this conversation&apos;s messages and unsent drafts/attachments? Action audit
            records, including action arguments and results, are retained separately. Executed
            changes are not undone.
          </p>
          <button type="button" disabled={isBusy} onClick={onRemove}>
            Delete conversation history
          </button>
          <button
            type="button"
            onClick={() => {
              setDeleting(false);
            }}
          >
            Keep conversation
          </button>
        </div>
      )}
    </div>
  );
}

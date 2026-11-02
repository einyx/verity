import { type ChatSession, chatTitleGuard } from '@logto/schemas';
import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from 'react-modal';

import styles from './workspace.module.scss';

export default function SessionControls({
  session,
  isBusy,
  onChange,
  onRemove,
  onOpenChange,
}: {
  readonly session: ChatSession;
  readonly isBusy: boolean;
  readonly onChange: (input: { title?: string; archived?: boolean }) => void;
  readonly onRemove: () => void;
  readonly onOpenChange?: (open: boolean) => void;
}) {
  const [view, setView] = useState<'menu' | 'rename' | 'delete'>();
  const [editedTitle, setEditedTitle] = useState<string>();
  const trigger = useRef<HTMLButtonElement>(null);
  const [content, setContent] = useState<HTMLDivElement>();
  const title = editedTitle ?? session.title;
  const valid = chatTitleGuard.safeParse(title).success;
  const dismiss = () => {
    setView(undefined);
  };
  const focusContent = useCallback(() => {
    content?.querySelector<HTMLElement>('input, button:not(:disabled)')?.focus();
  }, [content]);
  useEffect(() => {
    focusContent();
  }, [view, focusContent]);
  useEffect(() => {
    onOpenChange?.(Boolean(view));
    return () => {
      onOpenChange?.(false);
    };
  }, [view, onOpenChange]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={styles.close}
        aria-label="Conversation actions"
        aria-haspopup="menu"
        aria-expanded={view === 'menu'}
        onClick={() => {
          setView('menu');
        }}
      >
        <span aria-hidden="true">•••</span>
      </button>
      <Modal
        shouldCloseOnOverlayClick
        isOpen={Boolean(view)}
        ariaHideApp={false}
        role={view === 'delete' ? 'alertdialog' : 'dialog'}
        contentLabel={
          view === 'menu'
            ? 'Conversation actions'
            : view === 'delete'
              ? 'Delete conversation'
              : 'Rename conversation'
        }
        overlayClassName={styles.historyOverlay}
        className={`${styles.historyDialog} ${view === 'menu' ? styles.menuDialog : ''}`}
        contentRef={setContent}
        onRequestClose={(event) => {
          event.stopPropagation();
          dismiss();
        }}
        onAfterClose={() => {
          trigger.current?.focus();
        }}
        onAfterOpen={focusContent}
      >
        {view === 'menu' && (
          <div
            className={styles.actionMenu}
            role="menu"
            aria-label="Conversation actions"
            tabIndex={-1}
            onKeyDown={(event) => {
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                return;
              }
              const items = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
              ];
              const index =
                document.activeElement instanceof HTMLButtonElement
                  ? items.indexOf(document.activeElement)
                  : -1;
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? items.length - 1
                    : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
              event.preventDefault();
              items[next]?.focus();
            }}
          >
            <button
              type="button"
              role="menuitem"
              className={styles.close}
              disabled={isBusy || Boolean(session.archivedAt)}
              onClick={() => {
                setEditedTitle(undefined);
                setView('rename');
              }}
            >
              Rename…
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.close}
              disabled={isBusy}
              onClick={() => {
                dismiss();
                onChange({ archived: !session.archivedAt });
              }}
            >
              {session.archivedAt ? 'Restore' : 'Archive'}
            </button>
            <button
              type="button"
              role="menuitem"
              className={`${styles.close} ${styles.destructive}`}
              disabled={isBusy}
              onClick={() => {
                setView('delete');
              }}
            >
              Delete conversation…
            </button>
          </div>
        )}
        {view === 'rename' && (
          <form
            className={styles.actionMenu}
            onSubmit={(event) => {
              event.preventDefault();
              if (!isBusy && !session.archivedAt && valid && title !== session.title) {
                dismiss();
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
              className={styles.close}
              disabled={isBusy || Boolean(session.archivedAt) || !valid || title === session.title}
            >
              Rename
            </button>
            <button type="button" className={styles.close} onClick={dismiss}>
              Cancel
            </button>
          </form>
        )}
        {view === 'delete' && (
          <div className={styles.actionMenu}>
            <p>
              Delete this conversation&apos;s messages and unsent drafts/attachments? Action audit
              records, including action arguments and results, are retained separately. Executed
              changes are not undone.
            </p>
            <button type="button" className={styles.close} onClick={dismiss}>
              Keep conversation
            </button>
            <button
              type="button"
              className={`${styles.close} ${styles.destructive}`}
              disabled={isBusy}
              onClick={() => {
                dismiss();
                onRemove();
              }}
            >
              Delete conversation history
            </button>
          </div>
        )}
      </Modal>
    </>
  );
}

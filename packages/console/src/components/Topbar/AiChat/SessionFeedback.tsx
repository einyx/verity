import { type SessionController } from './session-controller';
import { type SessionSnapshot } from './session-state';

export default function SessionFeedback({
  controller,
  state,
  search,
  isArchived,
}: {
  readonly controller: SessionController;
  readonly state: SessionSnapshot;
  readonly search: string;
  readonly isArchived: boolean;
}) {
  const active = state.records[state.activeId ?? ''];
  const { creationConflictId } = state;
  return (
    <>
      {creationConflictId && (
        <section role="alert">
          <p>
            The original unsaved draft and the newer conversation draft are both preserved. Choose
            recovery before starting another conversation.
          </p>
          <button
            type="button"
            onClick={() => {
              void controller.openSession(creationConflictId);
            }}
          >
            Review existing conversation
          </button>
          <button
            type="button"
            onClick={() => {
              void (async () => {
                const id = await controller.recoverCreation();
                if (id) {
                  await controller.flush(id);
                }
              })();
            }}
          >
            Recover original draft in a new conversation
          </button>
        </section>
      )}
      {state.error && (
        <p role="alert">
          {state.error} · Your draft is preserved.{' '}
          <button
            type="button"
            onClick={() => {
              void controller.list(isArchived, search);
              if (state.activeId) {
                void controller.refresh(state.activeId, true);
              }
            }}
          >
            Retry loading
          </button>
        </p>
      )}
      {Object.values(state.records).map(
        (record) =>
          record &&
          ['failed', 'conflict'].includes(record.saveState) && (
            <p key={record.session.id} role="status">
              Unsent draft needs attention:{' '}
              <button
                type="button"
                onClick={() => {
                  void controller.openSession(record.session.id);
                }}
              >
                {record.session.title}
              </button>
            </p>
          )
      )}
      {active?.error && (
        <div role="alert">
          <p>{active.error} · Recheck status before making another attempt.</p>
          <button
            type="button"
            onClick={() => {
              void controller.refresh(active.session.id, true);
            }}
          >
            Check turn status
          </button>
          {active.turn &&
            ['failed', 'interrupted'].includes(active.turn.state) &&
            !active.draft.text &&
            active.draft.attachments.length === 0 && (
              <button
                type="button"
                onClick={() => {
                  controller.prepareRetry(active.session.id);
                }}
              >
                Copy previous prompt for a new attempt
              </button>
            )}
        </div>
      )}
      {active && (Boolean(active.messageCursor) || active.messages.length > 40) && (
        <p>Older history may be omitted from the AI context.</p>
      )}
    </>
  );
}

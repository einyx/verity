import { useState } from 'react';

import Composer from './Composer';
import { readAttachments } from './attachments';
import { type SessionController } from './session-controller';
import useSessionComposer from './use-session-composer';

export default function SessionDraft({
  controller,
  sessionId,
}: {
  readonly controller: SessionController;
  readonly sessionId?: string;
}) {
  const composer = useSessionComposer(controller, sessionId);
  const [attachmentError, setAttachmentError] = useState<{ sessionId?: string; message: string }>();
  const record = controller.getSnapshot().records[sessionId ?? ''];
  if (sessionId && !record) {
    return <p role="status">Loading the saved draft…</p>;
  }
  const readOnly = Boolean(record?.session.archivedAt);
  return (
    <>
      <p>
        Chat history and unsent drafts/attachments are saved to your account. Do not attach
        credentials or secrets.
      </p>
      {readOnly ? (
        <p role="status">Archived conversation · restore to continue</p>
      ) : (
        <>
          <Composer
            isEditableWhileLoading
            value={composer.draft.text}
            attachments={composer.draft.attachments}
            attachmentError={
              attachmentError?.sessionId === sessionId ? attachmentError?.message : undefined
            }
            isLoading={Boolean(record?.running) || Boolean(record?.operation)}
            hasContent={
              Boolean(composer.draft.text.trim()) || composer.draft.attachments.length > 0
            }
            onChange={composer.setText}
            onSubmit={() => {
              void controller.send();
            }}
            onFilesSelected={(files) => {
              void (async () => {
                const target = sessionId ?? (await controller.newSession());
                const { added, rejected } = await readAttachments(files);
                setAttachmentError(
                  rejected.length > 0
                    ? { sessionId: target, message: `Could not attach: ${rejected.join(', ')}` }
                    : undefined
                );
                controller.addAttachments(added, target ?? '');
              })();
            }}
            onRemoveAttachment={composer.removeAttachment}
          />
          <p role="status">
            {
              {
                saved: 'Saved',
                saving: 'Saving…',
                dirty: 'Not saved',
                failed: 'Not saved · retry',
                conflict: 'Another device changed this draft. Your input is preserved.',
              }[composer.saveState]
            }
          </p>
          {(composer.saveState === 'failed' || (!sessionId && controller.getSnapshot().error)) && (
            <button
              type="button"
              onClick={() => {
                void composer.flush();
              }}
            >
              Retry draft save
            </button>
          )}
          {composer.conflict && (
            <div role="alert">
              <p>Choose which draft to keep. Replacing uses the latest server revision.</p>
              <button
                type="button"
                onClick={() => {
                  void composer.resolveConflict('load');
                }}
              >
                Load server draft
              </button>
              <button
                type="button"
                onClick={() => {
                  void composer.resolveConflict('replace');
                }}
              >
                Replace server draft
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

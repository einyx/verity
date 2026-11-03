import { useState } from 'react';
import { isLandingPageReviewRequest } from '@logto/schemas';

import Composer from './Composer';
import { readAttachments } from './attachments';
import { type SessionController } from './session-controller';
import useSessionComposer from './use-session-composer';
import useTransientLandingReview from './use-transient-landing-review';

export default function SessionDraft({
  controller,
  sessionId,
}: {
  readonly controller: SessionController;
  readonly sessionId?: string;
}) {
  const composer = useSessionComposer(controller, sessionId);
  const review = useTransientLandingReview();
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
            isLoading={review.busy || Boolean(record?.running) || Boolean(record?.operation)}
            hasContent={
              Boolean(composer.draft.text.trim()) || composer.draft.attachments.length > 0
            }
            onChange={composer.setText}
            onSubmit={() => {
              if (isLandingPageReviewRequest(composer.draft.text)) {
                void review.review(composer.draft.text);
                return;
              }
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
          <button type="button" disabled={review.busy} onClick={() => { void review.review(composer.draft.text || 'Review the landing page and suggest one improvement to preview. Do not save or publish.'); }}>Review landing page · no save</button>
          {review.panel}
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

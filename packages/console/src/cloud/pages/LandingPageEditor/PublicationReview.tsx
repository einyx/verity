import Modal from 'react-modal';

import { isRecord } from './ContentEditor';
import DraftChanges from './DraftChanges';
import styles from './index.module.scss';
import { documentsEqual } from './use-draft-session';

type Props = {
  readonly snapshot: unknown;
  readonly currentDraft: unknown;
  readonly published: unknown;
  readonly publishedVersion?: number;
  readonly liveVersion?: number;
  readonly restoreVersion?: number;
  readonly isBusy: boolean;
  readonly message?: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
};

function PublicationReview({
  snapshot,
  currentDraft,
  published,
  publishedVersion,
  liveVersion = publishedVersion,
  restoreVersion,
  isBusy,
  message,
  onConfirm,
  onCancel,
}: Props) {
  const stale =
    liveVersion !== publishedVersion ||
    (restoreVersion === undefined && !documentsEqual(snapshot, currentDraft));
  const chatEnabled =
    isRecord(snapshot) && isRecord(snapshot.demoChat) && snapshot.demoChat.enabled === true;
  const appElement = document.querySelector<HTMLElement>('#app');

  return (
    <Modal
      isOpen
      contentLabel={restoreVersion === undefined ? 'Review publication' : 'Review rollback'}
      appElement={appElement ?? undefined}
      ariaHideApp={Boolean(appElement)}
      shouldCloseOnEsc={!isBusy}
      shouldCloseOnOverlayClick={!isBusy}
      className={styles.reviewDialog}
      overlayClassName={styles.reviewOverlay}
      onRequestClose={() => {
        if (!isBusy) {
          onCancel();
        }
      }}
    >
      <h2 className={styles.reviewTitle}>
        {restoreVersion === undefined
          ? 'Publish reviewed draft?'
          : `Make version ${restoreVersion} live?`}
      </h2>
      <p>
        {publishedVersion
          ? `This will replace website version ${publishedVersion}`
          : 'This will publish your website for the first time'}
        {restoreVersion === undefined
          ? ' with the draft reviewed below.'
          : ` with version ${restoreVersion}.`}
      </p>
      <p>
        <strong>Demo chat: {chatEnabled ? 'visible' : 'hidden'}</strong>
      </p>
      {restoreVersion !== undefined && <p>Your editing draft will not change.</p>}
      <DraftChanges before={published} after={snapshot} />
      {stale && (
        <p role="alert" className={styles.error}>
          The draft or website changed since this review. Cancel and review the latest changes
          before publishing.
        </p>
      )}
      {message && (
        <p role="alert" className={styles.error}>
          {message}
        </p>
      )}
      <div className={styles.reviewFooter}>
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={isBusy}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={isBusy || stale}
          onClick={() => {
            if (!stale && !isBusy) {
              onConfirm();
            }
          }}
        >
          {isBusy
            ? 'Publishing…'
            : restoreVersion === undefined
              ? 'Publish reviewed draft'
              : `Make version ${restoreVersion} live`}
        </button>
      </div>
    </Modal>
  );
}

export default PublicationReview;

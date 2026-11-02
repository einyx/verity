import { landingPageDocumentGuard } from '@logto/schemas';
import { useId, useState } from 'react';

import { type ProposedAction } from './ProposedActionCard';
import ReadOnlyLandingPreview from './ReadOnlyLandingPreview';
import styles from './index.module.scss';
import useReviewExpiry from './use-review-expiry';

type Props = {
  readonly action: ProposedAction;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly onRefresh?: () => Promise<void>;
};

function LandingPageArtifact({ action, onConfirm, onCancel, onRefresh }: Props) {
  const previewId = useId();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const busy = Boolean(action.operation) || isRefreshing || action.status === 'running';
  const expired = useReviewExpiry(action.expiresAt);
  const showExpired = expired && (action.status === 'pending' || action.status === 'failed');
  const canRefresh = showExpired || action.status === 'failed';
  const document = landingPageDocumentGuard.safeParse(action.body);
  const status = {
    pending: 'Not saved',
    running: 'Saving draft…',
    done: 'Draft saved',
    cancelled: 'Discarded',
    failed: 'Not saved',
  };

  return (
    <section
      aria-label="Landing page draft proposal"
      className={styles.landingArtifact}
      data-expanded={isExpanded}
    >
      <header className={styles.artifactHeader}>
        <h3>Landing page draft</h3>
        <span role="status" className={styles.artifactStatus}>
          {showExpired ? 'Review expired' : status[action.status]}
        </span>
      </header>
      <p className={styles.artifactHint}>
        Preview only. Save a draft to update the editor; publishing is separate.
      </p>
      {document.success ? (
        <>
          <ReadOnlyLandingPreview id={previewId} document={document.data} isExpanded={isExpanded} />
          <button
            type="button"
            className={styles.artifactSecondary}
            aria-expanded={isExpanded}
            aria-controls={previewId}
            onClick={() => {
              setIsExpanded((current) => !current);
            }}
          >
            {isExpanded ? 'Collapse preview' : 'Expand preview'}
          </button>
        </>
      ) : (
        <p role="alert">Preview unavailable: this proposal is not a valid landing-page draft.</p>
      )}
      {action.status === 'pending' && (
        <div className={styles.actionButtons}>
          {document.success && (
            <button
              type="button"
              className={styles.actionConfirm}
              disabled={expired || busy}
              onClick={onConfirm}
            >
              Save draft
            </button>
          )}
          <button type="button" className={styles.actionCancel} disabled={busy} onClick={onCancel}>
            Discard
          </button>
        </div>
      )}
      {showExpired && (
        <p role="alert">
          This review expired. Your proposed edits are still here; refresh the review before saving.
        </p>
      )}
      {document.success && canRefresh && onRefresh && (
        <div className={styles.actionButtons}>
          <button
            type="button"
            className={styles.actionConfirm}
            disabled={busy}
            onClick={() => {
              if (busy) {
                return;
              }
              setIsRefreshing(true);
              setRefreshFailed(false);
              void (async () => {
                try {
                  await onRefresh();
                } catch {
                  setRefreshFailed(true);
                } finally {
                  setIsRefreshing(false);
                }
              })();
            }}
          >
            {isRefreshing ? 'Refreshing review…' : 'Refresh review'}
          </button>
          <p className={styles.artifactHint}>
            Refreshing keeps this proposed draft. It does not save, publish, or merge newer edits.
          </p>
        </div>
      )}
      {refreshFailed && (
        <p role="alert">
          The review could not be refreshed. Your proposed edits are still available.
        </p>
      )}
      {action.message && !showExpired && (
        <p role="alert" className={styles.error}>
          {action.message}
        </p>
      )}
    </section>
  );
}

export default LandingPageArtifact;

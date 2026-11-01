import { landingPageDocumentGuard } from '@logto/schemas';
import { useState } from 'react';

import { type ProposedAction } from './ProposedActionCard';
import ReadOnlyLandingPreview from './ReadOnlyLandingPreview';
import styles from './index.module.scss';

type Props = {
  readonly action: ProposedAction;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
};

function LandingPageArtifact({ action, onConfirm, onCancel }: Props) {
  const [isExpanded, setIsExpanded] = useState(false);
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
          {status[action.status]}
        </span>
      </header>
      <p className={styles.artifactHint}>
        Preview only. Save a draft to update the editor; publishing is separate.
      </p>
      {document.success ? (
        <>
          <ReadOnlyLandingPreview document={document.data} />
          <button
            type="button"
            className={styles.artifactSecondary}
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
            <button type="button" className={styles.actionConfirm} onClick={onConfirm}>
              Save draft
            </button>
          )}
          <button type="button" className={styles.actionCancel} onClick={onCancel}>
            Discard
          </button>
        </div>
      )}
      {action.message && (
        <p role="alert" className={styles.error}>
          {action.message}
        </p>
      )}
    </section>
  );
}

export default LandingPageArtifact;

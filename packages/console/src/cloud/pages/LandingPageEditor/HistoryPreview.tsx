import { useEffect, useRef, useState } from 'react';

import { type LandingPageVersion } from '@/cloud/hooks/use-landing-page';
import ReadOnlyLandingPreview from '@/components/Topbar/AiChat/ReadOnlyLandingPreview';

import DraftChanges from './DraftChanges';
import styles from './index.module.scss';
import { documentsEqual } from './use-draft-session';

type Props = {
  readonly version: LandingPageVersion;
  readonly currentDraft: unknown;
  readonly publishedVersion?: number;
  readonly onRestore: (document: unknown) => void;
  readonly onClose: () => void;
};

function HistoryPreview({ version, currentDraft, publishedVersion, onRestore, onClose }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  const restoreTrigger = useRef<HTMLButtonElement>(null);
  const reviewWasOpen = useRef(false);
  const [restoreBase, setRestoreBase] = useState<unknown>();
  const stale = restoreBase !== undefined && !documentsEqual(restoreBase, currentDraft);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    if (restoreBase !== undefined) {
      // eslint-disable-next-line @silverhand/fp/no-mutation -- Track whether a removed review control needs its focus returned.
      reviewWasOpen.current = true;
      return;
    }
    if (reviewWasOpen.current) {
      restoreTrigger.current?.focus();
    }
    // eslint-disable-next-line @silverhand/fp/no-mutation -- Reset focus bookkeeping after returning to the restoration trigger.
    reviewWasOpen.current = false;
  }, [restoreBase]);

  return (
    <section aria-label={`Version ${version.version} preview`} className={styles.reviewPanel}>
      <div className={styles.reviewHeading}>
        <div>
          <h2 ref={heading} tabIndex={-1} className={styles.cardTitle}>
            Previewing version {version.version}
          </h2>
          <p className={styles.sectionHint}>
            Read-only ·{' '}
            {publishedVersion ? `Website: version ${publishedVersion}` : 'Website: not published'}.
            Your working draft has not changed.
          </p>
        </div>
        <button type="button" className={styles.secondaryButton} onClick={onClose}>
          Return to current draft
        </button>
      </div>
      <ReadOnlyLandingPreview isExpanded document={version.document} />
      {restoreBase === undefined ? (
        <button
          ref={restoreTrigger}
          type="button"
          className={styles.secondaryButton}
          onClick={() => {
            setRestoreBase(currentDraft);
          }}
        >
          Restore to draft
        </button>
      ) : (
        <section aria-label="Review draft restoration">
          <h3 className={styles.cardTitle}>Restore version {version.version} to draft?</h3>
          <p>
            This replaces your working draft, including unsaved edits. The website will not change.
            Use Undo to recover your previous draft.
          </p>
          <DraftChanges before={restoreBase} after={version.document} />
          {stale && (
            <p role="alert">Your working draft changed. Cancel and review the restoration again.</p>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={stale}
              onClick={() => {
                if (!stale) {
                  onRestore(version.document);
                }
              }}
            >
              Restore version {version.version} to draft
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => {
                setRestoreBase(undefined);
              }}
            >
              Cancel restoration
            </button>
          </div>
        </section>
      )}
    </section>
  );
}

export default HistoryPreview;

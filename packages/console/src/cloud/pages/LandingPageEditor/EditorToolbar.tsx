import { type LandingPageVersion } from '@/cloud/hooks/use-landing-page';
import { isDevFeaturesEnabled } from '@/consts/env';

import { isRecord } from './ContentEditor';
import { setAtPath } from './LandingPreviewFrame';
import styles from './index.module.scss';

type Props = {
  readonly draft: unknown;
  readonly status: string;
  readonly publishedVersion?: number;
  readonly versions: LandingPageVersion[];
  readonly hasVersionsError: boolean;
  readonly isBusy: boolean;
  readonly onDraftChange: (document: unknown) => void;
  readonly onSave: () => void;
  readonly onPublish: () => void;
  readonly onRollback: (version: number) => void;
  readonly onEditWithAi: () => void;
  readonly onPreviewVersion: (version: number) => void;
  readonly isViewingHistory?: boolean;
};

function EditorToolbar({
  draft,
  status,
  publishedVersion,
  versions,
  hasVersionsError,
  isBusy,
  onDraftChange,
  onSave,
  onPublish,
  onRollback,
  onEditWithAi,
  onPreviewVersion,
  isViewingHistory = false,
}: Props) {
  const chatEnabled =
    isRecord(draft) && isRecord(draft.demoChat) && draft.demoChat.enabled === true;

  return (
    <header className={styles.editorTopbar}>
      <div className={styles.editorIdentity}>
        <div className={styles.editorIdentityTitle}>
          <h1 className={styles.topbarTitle}>Landing page</h1>
          <span role="status" aria-label="Draft status" className={styles.message}>
            {status}
          </span>
        </div>
        <span className={styles.sectionHint}>
          {publishedVersion ? `Website: version ${publishedVersion}` : 'Website: not published'}
        </span>
      </div>
      <div className={styles.topbarActions}>
        <details className={styles.versionsMenu}>
          <summary data-history-trigger>History</summary>
          <section aria-label="Publication history" className={styles.versionsPop}>
            <h2 className={styles.cardTitle}>Publication history</h2>
            {hasVersionsError && (
              <p role="alert" className={styles.error}>
                Could not load history. Reload the page to try again.
              </p>
            )}
            {!hasVersionsError && versions.length === 0 && (
              <p className={styles.sectionHint}>No published versions yet.</p>
            )}
            <ul className={styles.versions}>
              {versions.map((item) => (
                <li key={item.version} className={styles.versionRow}>
                  <strong>Version {item.version}</strong>
                  {item.version === publishedVersion && (
                    <span className={styles.liveBadge}>Published</span>
                  )}
                  <span className={styles.sectionHint}>
                    By {item.publishedBy} · {item.createdAt}
                  </span>
                  {/* Landing-page history previews are part of the editor review workflow. */}
                  {isDevFeaturesEnabled && (
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      aria-label={`Preview version ${item.version}`}
                      onClick={(event) => {
                        onPreviewVersion(item.version);
                        event.currentTarget.closest('details')?.removeAttribute('open');
                      }}
                    >
                      Preview
                    </button>
                  )}
                  {item.version !== publishedVersion && (
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      disabled={isBusy}
                      onClick={() => {
                        onRollback(item.version);
                      }}
                    >
                      Make live
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </details>
        <details className={styles.versionsMenu}>
          <summary>Page settings</summary>
          <section aria-label="Page settings" className={styles.versionsPop}>
            <h2 className={styles.cardTitle}>Page settings</h2>
            <label className={styles.checkField}>
              <input
                type="checkbox"
                checked={chatEnabled}
                disabled={isViewingHistory}
                onChange={(event) => {
                  onDraftChange(setAtPath(draft, 'demoChat.enabled', event.target.checked));
                }}
              />
              <span>Show demo chat</span>
            </label>
            <p className={styles.sectionHint}>Takes effect when published.</p>
          </section>
        </details>
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={isBusy || isViewingHistory}
          onClick={onEditWithAi}
        >
          Edit with AI
        </button>
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={isBusy || isViewingHistory}
          onClick={onSave}
        >
          Save draft
        </button>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={isBusy || isViewingHistory}
          onClick={onPublish}
        >
          Publish
        </button>
      </div>
    </header>
  );
}

export default EditorToolbar;

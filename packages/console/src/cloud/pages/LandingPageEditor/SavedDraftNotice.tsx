import DraftChanges from './DraftChanges';
import styles from './index.module.scss';

type Props = {
  readonly local: unknown;
  readonly incoming: unknown;
  readonly onLoad: () => void;
  readonly onKeep: () => void;
};

function SavedDraftNotice({ local, incoming, onLoad, onKeep }: Props) {
  return (
    <section aria-label="Saved draft update" className={styles.reviewPanel}>
      <h2 className={styles.cardTitle}>A newer draft was saved</h2>
      <p role="status">
        Ask AI or another editor saved an update. Your unsaved edits are still here. Loading the
        saved draft will replace them.
      </p>
      <details>
        <summary>Review saved draft</summary>
        <DraftChanges before={local} after={incoming} />
      </details>
      <div className={styles.actions}>
        <button type="button" className={styles.secondaryButton} onClick={onLoad}>
          Load saved draft
        </button>
        <button type="button" className={styles.secondaryButton} onClick={onKeep}>
          Keep my edits
        </button>
      </div>
    </section>
  );
}

export default SavedDraftNotice;

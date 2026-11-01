import { draftChanges } from './draft-changes';
import styles from './index.module.scss';

type Props = { readonly before: unknown; readonly after: unknown };

function DraftChanges({ before, after }: Props) {
  const changes = draftChanges(before, after);
  return changes.length === 0 ? (
    <p className={styles.sectionHint}>No content changes.</p>
  ) : (
    <ul className={styles.changeList} aria-label="Changed fields">
      {changes.map((change) => (
        <li key={change.path}>
          <strong>{change.path}</strong>
          <div className={styles.changeValues}>
            <div>
              <span className={styles.sectionHint}>Before</span>
              <del>{change.before}</del>
            </div>
            <div>
              <span className={styles.sectionHint}>After</span>
              <ins>{change.after}</ins>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default DraftChanges;

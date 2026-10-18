import styles from '../index.module.scss';

import workspaceCluster from '@/assets/images/wizard/workspace-cluster.svg?url';

import { type StackOption } from './options';

// Existing wizard artwork, one per template, shown on the card's band.
const artwork: Record<StackOption['id'], string> = {
  foundation: workspaceCluster,
  dai: workspaceCluster,
  fai: workspaceCluster,
  v1: workspaceCluster,
};

// One workspace choice. The whole row is the button; a disabled option shows its label instead.
function ChoiceItem({
  option,
  selected,
  onSelect,
}: {
  readonly option: StackOption;
  readonly selected?: StackOption;
  readonly onSelect: () => void;
}) {
  const isSelected = selected?.id === option.id;

  return (
    <button
      type="button"
      disabled={!option.available}
      aria-pressed={isSelected}
      className={`${styles.quickstartItem} ${styles.templateCard} ${isSelected ? styles.quickstartItemSelected : ''}`}
      onClick={onSelect}
    >
      <span className={styles.templateBand} data-option={option.id} aria-hidden="true">
        <img className={styles.templateArt} src={artwork[option.id]} alt="" />
      </span>
      <span className={styles.choiceMain}>
        <span className={styles.choiceIcon} aria-hidden="true">
          {option.title.charAt(0)}
        </span>
        <span className={styles.quickstartText}>
          <span className={styles.choiceTitle}>{option.title}</span>
          <span className={styles.muted}>{option.description}</span>
        </span>
      </span>
      <ChoiceMarker isAvailable={option.available} isSelected={isSelected} />
    </button>
  );
}

// The right-hand mark on each choice: a radio when it can be picked, or a label when it cannot yet.
function ChoiceMarker({
  isAvailable,
  isSelected,
}: {
  readonly isAvailable: boolean;
  readonly isSelected: boolean;
}) {
  if (!isAvailable) {
    return <span className={styles.badge}>Coming soon</span>;
  }

  return (
    <span className={`${styles.radio} ${isSelected ? styles.radioOn : ''}`} aria-hidden="true" />
  );
}

export default ChoiceItem;

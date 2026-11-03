import PrysmWordmark from '@/assets/images/prysm-wordmark.svg';

import styles from './index.module.scss';

// The console wordmark stands alone: there is no separate emblem.
function Topbar() {
  return (
    <div className={styles.topbar}>
      <div className={styles.brand}>
        <PrysmWordmark className={styles.wordmark} aria-label="Prysm" />
      </div>
    </div>
  );
}

export default Topbar;

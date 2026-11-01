import prysmWordmark from '@/assets/images/prysm-wordmark.svg';

import styles from './index.module.scss';

// The console wordmark stands alone: there is no separate emblem.
function Topbar() {
  return (
    <div className={styles.topbar}>
      <div className={styles.brand}>
        <img className={styles.wordmark} src={prysmWordmark} alt="Prysm" />
      </div>
    </div>
  );
}

export default Topbar;

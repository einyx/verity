import CloudLogo from '@/assets/images/cloud-logo.svg?react';
import PrysmMark from '@/assets/images/prysm-mark.svg?react';

import styles from './index.module.scss';

// The same lockup as the console topbar: the mark, then the wordmark.
function Topbar() {
  return (
    <div className={styles.topbar}>
      <div className={styles.brand}>
        <PrysmMark className={styles.mark} />
        <CloudLogo className={styles.logo} />
      </div>
    </div>
  );
}

export default Topbar;

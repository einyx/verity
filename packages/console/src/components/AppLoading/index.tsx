import Logo from '@/assets/images/logo.svg?react';

import styles from './index.module.scss';

// Crop the logo to the wordmark's own bounds so it stays centered above the spinner.
const logoViewBox = '110.68 32.18 345.18 68.68';

function AppLoading() {
  return (
    <div className={styles.container}>
      <Logo className={styles.logo} viewBox={logoViewBox} />
      <span className={styles.spinner} role="status" aria-label="Loading" />
    </div>
  );
}

export default AppLoading;

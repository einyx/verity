import Logo from '@/assets/images/logo.svg?react';

import styles from './index.module.scss';

// Crop the logo to the wordmark's own bounds so it stays centered above the spinner. The crop has
// to start above the X, whose ascender is taller than the other letters.
const logoViewBox = '110.68 12 345.18 88.86';

function AppLoading() {
  return (
    <div className={styles.container}>
      <Logo className={styles.logo} viewBox={logoViewBox} />
      <span className={styles.spinner} role="status" aria-label="Loading" />
    </div>
  );
}

export default AppLoading;

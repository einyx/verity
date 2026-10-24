import type { ReactNode } from 'react';

import CometBackground from './CometBackground';
import styles from './index.module.scss';

// Wraps the infrastructure pages. They use the console's own colors, fonts, and theme, like every
// other page; the wrapper only adds the comet background behind the content.
function InfraShell({ children }: { readonly children: ReactNode }) {
  return (
    <div className={styles.infraShell}>
      <CometBackground />
      {children}
    </div>
  );
}

export default InfraShell;

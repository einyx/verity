import type { ReactNode } from 'react';

import styles from './index.module.scss';

type Props = {
  readonly title: string;
  readonly children: ReactNode;
  readonly collapsed?: boolean;
};

function Section({ children, title, collapsed = false }: Props) {
  return (
    <div>
      {!collapsed && <div className={styles.title}>{title}</div>}
      {children}
    </div>
  );
}

export default Section;

import { useId, type ReactNode } from 'react';

import styles from './index.module.scss';

type Props = {
  readonly title: string;
  readonly children: ReactNode;
  // eslint-disable-next-line react/boolean-prop-naming -- Keep the existing `collapsed` prop name; callers outside this change depend on it.
  readonly collapsed?: boolean;
  readonly isRevealed?: boolean;
  readonly isStatic?: boolean;
  readonly onToggle?: () => void;
};

function Section({
  children,
  title,
  collapsed = false,
  isRevealed = true,
  isStatic = false,
  onToggle,
}: Props) {
  const id = useId();
  return (
    <section className={styles.section} aria-label={title}>
      {!collapsed && isStatic && <div className={styles.title}>{title}</div>}
      {!collapsed && !isStatic && (
        <button
          type="button"
          className={styles.title}
          aria-expanded={isRevealed}
          aria-controls={id}
          onClick={onToggle}
        >
          {title}
          <span aria-hidden>{isRevealed ? '⌄' : '›'}</span>
        </button>
      )}
      <div id={id} hidden={!collapsed && !isRevealed}>
        {children}
      </div>
    </section>
  );
}

export default Section;

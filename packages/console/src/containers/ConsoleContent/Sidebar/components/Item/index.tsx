import classNames from 'classnames';
import type { TFuncKey } from 'i18next';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import useTenantPathname from '@/hooks/use-tenant-pathname';

import { getPath } from '../../utils';

import styles from './index.module.scss';

type Props = {
  readonly icon?: ReactNode;
  readonly titleKey: TFuncKey<'translation', 'admin_console.tabs'>;
  readonly isActive?: boolean;
  readonly modal?: (isOpen: boolean, onCancel: () => void) => ReactNode;
  readonly externalLink?: string;
  readonly path?: string;
  // eslint-disable-next-line react/boolean-prop-naming -- Keep the existing `collapsed` prop name; callers outside this change depend on it.
  readonly collapsed?: boolean;
};

function Item({
  icon,
  titleKey,
  modal,
  externalLink,
  path,
  isActive = false,
  collapsed = false,
}: Props) {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'admin_console.tabs',
  });
  const { getTo } = useTenantPathname();
  const [isOpen, setIsOpen] = useState(false);

  const content = useMemo(
    () => (
      <>
        {icon && (
          <div className={styles.icon} title={collapsed ? t(titleKey) : undefined}>
            {icon}
          </div>
        )}
        {!collapsed && <div className={styles.title}>{t(titleKey)}</div>}
      </>
    ),
    [collapsed, icon, t, titleKey]
  );

  if (modal) {
    return (
      <>
        <button
          className={styles.row}
          onClick={() => {
            setIsOpen(true);
          }}
        >
          {content}
        </button>
        {modal(isOpen, () => {
          setIsOpen(false);
        })}
      </>
    );
  }

  if (externalLink) {
    return (
      <a href={externalLink} target="_blank" className={styles.row} rel="noopener">
        {content}
      </a>
    );
  }

  return (
    <Link
      data-tour={titleKey}
      to={getTo(`/${path ?? getPath(titleKey)}`)}
      className={classNames(styles.row, isActive && styles.active)}
    >
      {content}
    </Link>
  );
}

export default Item;

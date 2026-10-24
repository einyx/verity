import classNames from 'classnames';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import OverlayScrollbar from '@/ds-components/OverlayScrollbar';
import useMatchTenantPath from '@/hooks/use-tenant-pathname';

import OssCloudCard from './OssCloudCard';
import Item from './components/Item';
import Section from './components/Section';
import { useSidebarMenuItems } from './hook';
import styles from './index.module.scss';
import { getPath } from './utils';

const defaultWidth = 280;
const collapsedWidth = 60;
const minWidth = 200;
const maxWidth = 480;
const storageKey = 'console-sidebar-width';
const collapsedStorageKey = 'console-sidebar-collapsed';

const clampWidth = (value: number) => Math.min(maxWidth, Math.max(minWidth, Math.round(value)));

const readStoredCollapsed = () => {
  try {
    return window.localStorage.getItem(collapsedStorageKey) === 'true';
  } catch {
    return false;
  }
};

const storeCollapsed = (value: boolean) => {
  try {
    window.localStorage.setItem(collapsedStorageKey, String(value));
  } catch {
    // Storage can be unavailable. The collapsed state still works for this view.
  }
};

const readStoredWidth = () => {
  try {
    const stored = Number(window.localStorage.getItem(storageKey));
    return Number.isFinite(stored) && stored > 0 ? clampWidth(stored) : defaultWidth;
  } catch {
    return defaultWidth;
  }
};

const storeWidth = (value: number) => {
  try {
    window.localStorage.setItem(storageKey, String(value));
  } catch {
    // Storage can be unavailable (private mode, blocked site data). The width still works for this view.
  }
};

export function Skeleton() {
  return <div className={styles.skeleton} />;
}

function Sidebar() {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'admin_console.tab_sections',
  });
  const { sections } = useSidebarMenuItems();
  const { match } = useMatchTenantPath();
  const [width, setWidth] = useState(readStoredWidth);
  const widthRef = useRef(width);
  const [isCollapsed, setIsCollapsed] = useState(readStoredCollapsed);
  // Animate only the collapse and expand toggle. Dragging should follow the pointer without lag.
  const [isDragging, setIsDragging] = useState(false);
  // The expanded width is kept while collapsed, so expanding restores it.
  const displayWidth = isCollapsed ? collapsedWidth : width;

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed((previous) => {
      storeCollapsed(!previous);
      return !previous;
    });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line @silverhand/fp/no-mutation -- the ref mirrors the latest width so the pointer handler reads it without re-binding
    widthRef.current = width;
  }, [width]);

  const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = widthRef.current;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    setIsDragging(true);

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      setWidth(clampWidth(startWidth + moveEvent.clientX - startX));
    };
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      setIsDragging(false);
      storeWidth(widthRef.current);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  }, []);

  // Arrow keys resize the sidebar for keyboard users.
  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 32 : 8;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const delta = event.key === 'ArrowRight' ? step : -step;
      const next = clampWidth(widthRef.current + delta);
      setWidth(next);
      storeWidth(next);
    }
  }, []);

  return (
    <div
      className={styles.sidebar}
      style={{ width: displayWidth, transition: isDragging ? 'none' : 'width 200ms ease-out' }}
    >
      {/* Like foundation-frontend's sidebar: the nav still scrolls, but no scrollbar is drawn. */}
      <OverlayScrollbar className={styles.menu} options={{ scrollbars: { visibility: 'hidden' } }}>
        <div className={classNames(styles.menuContent, isCollapsed && styles.menuContentCollapsed)}>
          <div className={classNames(styles.toggleRow, isCollapsed && styles.toggleRowCollapsed)}>
            <button
              type="button"
              className={styles.toggle}
              aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!isCollapsed}
              onClick={toggleCollapsed}
            >
              {isCollapsed ? '›' : '‹'}
            </button>
          </div>
          {sections.map(({ title, items }) => (
            <Section key={title} title={t(title)} collapsed={isCollapsed}>
              {items.map(
                ({ title, Icon, isHidden, modal, externalLink, path }) =>
                  !isHidden && (
                    <Item
                      key={title}
                      titleKey={title}
                      icon={<Icon />}
                      isActive={match('/' + (path ?? getPath(title)), true)}
                      modal={modal}
                      externalLink={externalLink}
                      path={path}
                      collapsed={isCollapsed}
                    />
                  )
              )}
            </Section>
          ))}
          {!isCollapsed && <OssCloudCard />}
        </div>
      </OverlayScrollbar>
      {!isCollapsed && (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- a focusable separator is the ARIA window-splitter pattern and needs pointer and keyboard handling
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuemin={collapsedWidth}
          aria-valuemax={maxWidth}
          aria-valuenow={displayWidth}
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the separator must be focusable so keyboard users can resize, per the ARIA window-splitter pattern
          tabIndex={0}
          className={styles.resizeHandle}
          onPointerDown={handlePointerDown}
          onKeyDown={handleKeyDown}
        />
      )}
    </div>
  );
}

export default Sidebar;

export * from './utils';

import { Theme } from '@logto/schemas';
import classNames from 'classnames';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { Link } from 'react-router-dom';

import AiChat from '@/components/Topbar/AiChat';
import TenantSelector from '@/components/Topbar/TenantSelector';
import { isCloud } from '@/consts/env';
import OverlayScrollbar from '@/ds-components/OverlayScrollbar';
import useAdminConsoleTour from '@/hooks/use-admin-console-tour';
import { isNarrowViewport } from '@/hooks/use-narrow-viewport';
import useTenantPathname from '@/hooks/use-tenant-pathname';
import useTheme from '@/hooks/use-theme';

import OssCloudCard from './OssCloudCard';
import Item from './components/Item';
import Section from './components/Section';
import styles from './index.module.scss';
import useShellNavigation from './use-shell-navigation';

const defaultWidth = 264;
const collapsedWidth = 60;
const minWidth = 200;
const maxWidth = 480;
// Keep existing saved widths; only a fresh rail adopts the HIG default.
const storageKey = 'console-sidebar-width-v2';
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
  useAdminConsoleTour();
  const theme = useTheme();
  const { getTo } = useTenantPathname();
  const { sections, active } = useShellNavigation();
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const [shouldFocusSearch, setShouldFocusSearch] = useState(false);
  const [disclosures, setDisclosures] = useState<Record<string, boolean>>({});
  const activeSection = active?.section.title;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredSections = sections
    .map((section) => ({
      ...section,
      items: section.items.filter(({ label }) =>
        label.toLocaleLowerCase().includes(normalizedQuery)
      ),
    }))
    .filter(({ items }) => items.length > 0);
  const [width, setWidth] = useState(readStoredWidth);
  const widthRef = useRef(width);
  // On a small device the sidebar starts collapsed: the expanded one covers the content.
  const [isCollapsed, setIsCollapsed] = useState(() => isNarrowViewport() || readStoredCollapsed());
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
    if (activeSection) {
      setDisclosures((current) => ({ ...current, [activeSection]: true }));
    }
  }, [activeSection]);

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsCollapsed(false);
        storeCollapsed(false);
        setShouldFocusSearch(true);
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => {
      window.removeEventListener('keydown', handleShortcut);
    };
  }, []);

  useEffect(() => {
    if (!isCollapsed && shouldFocusSearch) {
      searchRef.current?.focus();
      setShouldFocusSearch(false);
    }
  }, [isCollapsed, shouldFocusSearch]);

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
    <aside
      aria-label="Console navigation"
      className={classNames(styles.sidebar, !isCollapsed && styles.sidebarExpanded)}
      style={{ width: displayWidth, transition: isDragging ? 'none' : undefined }}
    >
      <div className={classNames(styles.scope, isCollapsed && styles.scopeCollapsed)}>
        <TenantSelector isCompact isCollapsed={isCollapsed} />
      </div>
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
          <div className={styles.search} hidden={isCollapsed}>
            <input
              ref={searchRef}
              type="search"
              aria-label="Search navigation"
              placeholder="Find a page"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setQuery('');
                }
              }}
            />
            {query ? (
              <button
                type="button"
                aria-label="Clear navigation search"
                onClick={() => {
                  setQuery('');
                  searchRef.current?.focus();
                }}
              >
                ×
              </button>
            ) : (
              <kbd>{/Mac|iPhone|iPad/u.test(navigator.platform) ? '⇧ ⌘ K' : 'Ctrl ⇧ K'}</kbd>
            )}
          </div>
          {isCloud && <AiChat isSidebar className={styles.assistant} isCompact={isCollapsed} />}
          <nav aria-label="Product sections">
            {filteredSections.map(({ title, label, items }) => (
              <Section
                key={title}
                title={label}
                collapsed={isCollapsed}
                isStatic={Boolean(normalizedQuery)}
                isRevealed={
                  Boolean(normalizedQuery) ||
                  (disclosures[title] ?? (title === 'overview' || title === activeSection))
                }
                onToggle={() => {
                  setDisclosures((current) => ({
                    ...current,
                    [title]: !(current[title] ?? (title === 'overview' || title === activeSection)),
                  }));
                }}
              >
                {items.map(
                  ({ title, Icon, isHidden, modal, externalLink, path }) =>
                    !isHidden && (
                      <Item
                        key={title}
                        titleKey={title}
                        icon={<Icon />}
                        isActive={active?.item.title === title}
                        modal={modal}
                        externalLink={externalLink}
                        path={path}
                        collapsed={isCollapsed}
                      />
                    )
                )}
              </Section>
            ))}
          </nav>
          {filteredSections.length === 0 && !isCollapsed && (
            <div role="status" className={styles.empty}>
              No pages found. Clear search to see navigation.
            </div>
          )}
          {!isCollapsed && <OssCloudCard />}
        </div>
      </OverlayScrollbar>
      <Link className={styles.brand} to={getTo('/')} aria-label="MeshX home">
        <img
          src={theme === Theme.Dark ? '/console/meshx-logo-dark.svg' : '/console/meshx-logo.svg'}
          alt="meshX"
        />
      </Link>
      {!isCollapsed && (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- a focusable separator is the ARIA window-splitter pattern and needs pointer and keyboard handling
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuemin={minWidth}
          aria-valuemax={maxWidth}
          aria-valuenow={displayWidth}
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the separator must be focusable so keyboard users can resize, per the ARIA window-splitter pattern
          tabIndex={0}
          className={styles.resizeHandle}
          onPointerDown={handlePointerDown}
          onKeyDown={handleKeyDown}
        />
      )}
    </aside>
  );
}

export default Sidebar;

export * from './utils';

import classNames from 'classnames';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { isNarrowViewport, useNarrowViewport } from '@/hooks/use-narrow-viewport';

import styles from './index.module.scss';

const storageKey = 'console-sidebar-collapsed';
const readCollapsed = () => {
  try {
    return isNarrowViewport() || window.localStorage.getItem(storageKey) === 'true';
  } catch {
    return isNarrowViewport();
  }
};

const SidebarStateContext = createContext<
  | {
      isCollapsed: boolean;
      isNarrow: boolean;
      toggleCollapsed: () => void;
      expand: () => void;
    }
  | undefined
>(undefined);

export function SidebarStateProvider({ children }: { readonly children: ReactNode }) {
  const isNarrow = useNarrowViewport();
  const [isCollapsed, setIsCollapsed] = useState(readCollapsed);
  const [hasInteracted, setHasInteracted] = useState(false);
  const toggleCollapsed = useCallback(() => {
    setHasInteracted(true);
    setIsCollapsed((previous) => !previous);
  }, []);
  const expand = useCallback(() => {
    setHasInteracted(true);
    setIsCollapsed(false);
  }, []);
  useEffect(() => {
    if (!hasInteracted) {
      return;
    }
    try {
      window.localStorage.setItem(storageKey, String(isCollapsed));
    } catch {
      // Blocked storage must not prevent the control from working.
    }
  }, [hasInteracted, isCollapsed]);
  const value = useMemo(
    () => ({ isCollapsed, isNarrow, toggleCollapsed, expand }),
    [isCollapsed, isNarrow, toggleCollapsed, expand]
  );
  return <SidebarStateContext.Provider value={value}>{children}</SidebarStateContext.Provider>;
}

export function useSidebarState() {
  const value = useContext(SidebarStateContext);
  if (!value) {
    throw new Error('Sidebar state requires SidebarStateProvider');
  }
  return value;
}

export function SidebarToggle({ isOverlay = false }: { readonly isOverlay?: boolean }) {
  const { isCollapsed, isNarrow, toggleCollapsed } = useSidebarState();
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (isOverlay && isNarrow && !isCollapsed) {
      buttonRef.current?.focus();
    }
  }, [isOverlay, isNarrow, isCollapsed]);
  if (isOverlay !== (isNarrow && !isCollapsed)) {
    return null;
  }
  return (
    <button
      ref={buttonRef}
      type="button"
      className={classNames(
        styles.sidebarToggle,
        isOverlay ? styles.overlayToggle : styles.headingToggle
      )}
      aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      aria-controls="console-sidebar"
      aria-expanded={!isCollapsed}
      onClick={() => {
        toggleCollapsed();
        // The overlay close control disappears after closing; return focus to its heading peer.
        if (isOverlay && !isCollapsed) {
          queueMicrotask(() => {
            document.querySelector<HTMLButtonElement>(`button.${styles.headingToggle}`)?.focus();
          });
        }
      }}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <rect x="2.5" y="3.5" width="15" height="13" rx="2" stroke="currentColor" />
        <path d="M7 4v12" stroke="currentColor" />
      </svg>
    </button>
  );
}

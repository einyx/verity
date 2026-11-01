import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

const minWidth = 280;
const clamp = (width: number, maxWidth: number) =>
  Math.min(maxWidth, Math.max(minWidth, Math.round(width)));

const useInspectorResize = () => {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ active: false, x: 0, width: 320, pointerId: 0 });
  const [width, setWidth] = useState(320);
  const [maxWidth, setMaxWidth] = useState(560);
  const [isCompact, setIsCompact] = useState(window.innerWidth <= 1200);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) {
      return;
    }
    const measure = () => {
      const available = workspace.getBoundingClientRect().width;
      setIsCompact(window.innerWidth <= 1200 || (available > 0 && available < 900));
      if (available <= 0) {
        return;
      }
      // Reserve the section list (280px), a usable preview (320px), and the handle (12px).
      const maximum = Math.max(minWidth, Math.min(560, available - 612));
      setMaxWidth(maximum);
      setWidth((current) => clamp(current, maximum));
    };
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(workspace);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const stop = (event: PointerEvent<HTMLDivElement>) => {
    // eslint-disable-next-line @silverhand/fp/no-mutation -- The ref stores only the active pointer gesture, never document data.
    drag.current = { ...drag.current, active: false };
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = { ArrowLeft: width + 16, ArrowRight: width - 16, Home: minWidth, End: maxWidth };
    if (!(event.key in next)) {
      return;
    }
    event.preventDefault();
    if (event.key === 'Home') {
      setWidth(minWidth);
    } else if (event.key === 'End') {
      setWidth(maxWidth);
    } else {
      setWidth((current) => clamp(current + (event.key === 'ArrowLeft' ? 16 : -16), maxWidth));
    }
  };

  return {
    workspaceRef,
    width,
    isCompact,
    isDragging,
    separatorProps: {
      role: 'separator',
      tabIndex: 0,
      'aria-label': 'Resize properties',
      'aria-orientation': 'vertical' as const,
      'aria-controls': 'landing-editor-properties',
      'aria-valuemin': minWidth,
      'aria-valuemax': maxWidth,
      'aria-valuenow': width,
      'aria-valuetext': `${width} pixels`,
      onKeyDown,
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || isCompact) {
          return;
        }
        event.preventDefault();
        // eslint-disable-next-line @silverhand/fp/no-mutation -- Capture the gesture's initial coordinates and width for stable relative resizing.
        drag.current = { active: true, x: event.clientX, width, pointerId: event.pointerId };
        event.currentTarget.setPointerCapture(event.pointerId);
        setIsDragging(true);
      },
      onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
        const start = drag.current;
        if (!start.active || event.pointerId !== start.pointerId) {
          return;
        }
        setWidth(clamp(start.width + start.x - event.clientX, maxWidth));
      },
      onPointerUp: stop,
      onPointerCancel: stop,
      onLostPointerCapture: stop,
    },
  };
};

export default useInspectorResize;

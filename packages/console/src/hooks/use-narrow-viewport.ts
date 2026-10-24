import { useEffect, useState } from 'react';

/**
 * The console is a desktop application, but it is also opened on a phone.
 *
 * A phone cannot use a media query to detect itself here: the content pane keeps a desktop minimum
 * width, so the layout viewport expands to fit it and every `max-width` query is then evaluated
 * against the expanded width. The screen width is the device width and is not affected by that
 * expansion, so it is what tells the console that it is on a small device.
 */
const narrowBreakpoint = 768;

export const isNarrowViewport = (): boolean => {
  const { width } = window.screen;

  if (Number.isFinite(width) && width > 0) {
    return width < narrowBreakpoint;
  }

  return window.innerWidth < narrowBreakpoint;
};

/**
 * Marks the document as narrow so the stylesheets can drop the desktop minimum width and turn the
 * sidebar into an overlay. The class is on the document element because the rules that need it are
 * in shared stylesheets, outside the reach of a component.
 */
export const useNarrowViewport = (): boolean => {
  const [isNarrow, setIsNarrow] = useState(isNarrowViewport);

  useEffect(() => {
    const update = () => {
      setIsNarrow(isNarrowViewport());
    };

    update();
    window.addEventListener('resize', update);

    return () => {
      window.removeEventListener('resize', update);
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('isNarrow', isNarrow);
  }, [isNarrow]);

  return isNarrow;
};

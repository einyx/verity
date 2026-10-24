declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- An interface is required to augment the existing Window declaration.
  interface Window {
    // Jsdom exposes these on every window; the type library only declares them as globals.
    AbortController: typeof AbortController;
    AbortSignal: typeof AbortSignal;
  }
}

const resizeObserver = class {
  observe() {
    // The observer reports nothing in jsdom, which has no layout.
  }

  unobserve() {
    // The observer reports nothing in jsdom, which has no layout.
  }

  disconnect() {
    // The observer reports nothing in jsdom, which has no layout.
  }
};

const matchMedia = () => ({
  matches: true,
  addEventListener() {
    // The query never changes in a test.
  },
  removeEventListener() {
    // The query never changes in a test.
  },
});

/**
 * Jsdom lacks the browser APIs Puck's drag-and-drop layer needs. This installs them for the test
 * environment only, taking the AbortSignal classes from the same jsdom realm so events accept them.
 */
export const installPuckBrowserApis = (): void => {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const view = frame.contentWindow;

  // eslint-disable-next-line @silverhand/fp/no-mutating-assign -- the test environment needs these globals before Puck renders.
  Object.assign(globalThis, {
    AbortController: view?.AbortController ?? globalThis.AbortController,
    AbortSignal: view?.AbortSignal ?? globalThis.AbortSignal,
    matchMedia,
    ResizeObserver: resizeObserver,
  });
};

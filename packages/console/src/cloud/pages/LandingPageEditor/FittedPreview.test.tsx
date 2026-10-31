import { act, render, screen } from '@testing-library/react';

import FittedPreview from './FittedPreview';

const observe = jest.fn();
const disconnect = jest.fn();
const reportResize = jest.fn<void, [number]>();
const originalObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');

beforeEach(() => {
  jest.clearAllMocks();
  // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- Install the missing jsdom API for this test file; restore it after the suite.
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: class {
      observe = observe;
      unobserve = jest.fn();
      disconnect = disconnect;

      constructor(callback: ResizeObserverCallback) {
        reportResize.mockImplementation((width) => {
          const entry: ResizeObserverEntry = {
            target: document.body,
            contentRect: {
              x: 0,
              y: 0,
              width,
              height: 0,
              top: 0,
              right: width,
              bottom: 0,
              left: 0,
              toJSON: () => ({}),
            },
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          };
          callback([entry], this);
        });
      }
    },
  });
});

afterAll(() => {
  if (originalObserver) {
    // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- Restore the original global descriptor after mocking the browser API.
    Object.defineProperty(globalThis, 'ResizeObserver', originalObserver);
  } else {
    Reflect.deleteProperty(globalThis, 'ResizeObserver');
  }
});

it('fits a desktop preview inside the pane without shrinking its simulated viewport', () => {
  render(
    <FittedPreview width={1280}>
      <iframe sandbox="" title="Preview" style={{ width: 1280 }} />
    </FittedPreview>
  );
  act(() => {
    reportResize(896);
  });

  expect(screen.getByLabelText('Preview zoom').textContent).toBe('Fit · 70%');
  expect(screen.getByTitle('Preview').parentElement?.style.width).toBe('896px');
  expect(
    screen.getByTitle('Preview').parentElement?.style.getPropertyValue('--preview-scale')
  ).toBe('0.7');
  expect(screen.getByTitle('Preview').style.width).toBe('1280px');
});

it('does not enlarge small previews and preserves the iframe when device or pane widths change', () => {
  const { rerender } = render(
    <FittedPreview width={1280}>
      <iframe sandbox="" title="Preview" />
    </FittedPreview>
  );
  const frame = screen.getByTitle('Preview');
  act(() => {
    reportResize(896);
  });
  rerender(
    <FittedPreview width={390}>
      <iframe sandbox="" title="Preview" />
    </FittedPreview>
  );
  expect(screen.getByLabelText('Preview zoom').textContent).toBe('Fit · 100%');
  expect(frame.parentElement?.style.width).toBe('390px');
  act(() => {
    reportResize(195);
  });
  expect(screen.getByLabelText('Preview zoom').textContent).toBe('Fit · 50%');
  expect(screen.getByTitle('Preview')).toBe(frame);
});

it('retains a usable scale while hidden and updates again when shown', () => {
  render(
    <FittedPreview width={1280}>
      <iframe sandbox="" title="Preview" />
    </FittedPreview>
  );
  act(() => {
    reportResize(640);
  });
  act(() => {
    reportResize(0);
  });
  expect(screen.getByLabelText('Preview zoom').textContent).toBe('Fit · 50%');
  act(() => {
    reportResize(1280);
  });
  expect(screen.getByLabelText('Preview zoom').textContent).toBe('Fit · 100%');
});

it('disconnects its size observer on unmount', () => {
  const { unmount } = render(
    <FittedPreview width={1280}>
      <iframe sandbox="" title="Preview" />
    </FittedPreview>
  );
  expect(observe).toHaveBeenCalledTimes(1);
  unmount();
  expect(disconnect).toHaveBeenCalledTimes(1);
});

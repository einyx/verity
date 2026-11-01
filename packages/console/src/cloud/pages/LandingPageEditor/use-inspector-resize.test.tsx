import { fireEvent, render, screen } from '@testing-library/react';

import useInspectorResize from './use-inspector-resize';

function Harness() {
  const resize = useInspectorResize();
  return (
    <div ref={resize.workspaceRef}>
      {!resize.isCompact && <div {...resize.separatorProps} />}
      <output>{resize.width}</output>
    </div>
  );
}

beforeEach(() => {
  jest.replaceProperty(window, 'innerWidth', 1440);
  jest
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockReturnValue({ width: 1200 } as DOMRect);
  // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- jsdom lacks PointerEvent; this test-only constructor exposes pointer coordinates to React.
  Object.defineProperty(window, 'PointerEvent', { value: MouseEvent, configurable: true });
  // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- Test-only pointer capture methods stand in for browser APIs absent from jsdom.
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { value: jest.fn(), configurable: true },
    hasPointerCapture: { value: () => false, configurable: true },
    releasePointerCapture: { value: jest.fn(), configurable: true },
  });
});
afterEach(() => {
  jest.restoreAllMocks();
});

it('supports both arrow directions and Home/End width bounds', () => {
  render(<Harness />);
  const handle = screen.getByRole('separator', { name: 'Resize properties' });
  expect(handle.getAttribute('aria-valuenow')).toBe('320');
  fireEvent.keyDown(handle, { key: 'ArrowLeft' });
  expect(handle.getAttribute('aria-valuenow')).toBe('336');
  fireEvent.keyDown(handle, { key: 'ArrowRight' });
  expect(handle.getAttribute('aria-valuenow')).toBe('320');
  fireEvent.keyDown(handle, { key: 'End' });
  expect(handle.getAttribute('aria-valuenow')).toBe('560');
  fireEvent.keyDown(handle, { key: 'Home' });
  expect(handle.getAttribute('aria-valuenow')).toBe('280');
});

it('grows when dragged left and stops on pointer cancellation', () => {
  render(<Harness />);
  const handle = screen.getByRole('separator');
  fireEvent.pointerDown(handle, { clientX: 700, button: 0 });
  fireEvent.pointerMove(handle, { clientX: 600 });
  expect(handle.getAttribute('aria-valuenow')).toBe('420');
  fireEvent.pointerCancel(handle);
  fireEvent.pointerMove(handle, { clientX: 500 });
  expect(handle.getAttribute('aria-valuenow')).toBe('420');
});

it('clamps width to leave room for the preview and section list', () => {
  jest
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockReturnValue({ width: 960 } as DOMRect);
  render(<Harness />);
  const handle = screen.getByRole('separator');
  fireEvent.keyDown(handle, { key: 'End' });
  expect(handle.getAttribute('aria-valuenow')).toBe('348');
});

it('does not expose an inactive separator on compact screens', () => {
  jest.replaceProperty(window, 'innerWidth', 800);
  render(<Harness />);
  expect(screen.queryByRole('separator')).toBeNull();
});

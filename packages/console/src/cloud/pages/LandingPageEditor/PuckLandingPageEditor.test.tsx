import { defaultLandingPageContent } from '@logto/schemas';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import PuckLandingPageEditor from './PuckLandingPageEditor';
import type { installPuckBrowserApis } from './puck-test-environment';

jest.mock('@puckeditor/core/puck.css', () => ({}));
jest.mock('@puckeditor/core', () => {
  // The mock factory runs before the imports are initialized, so the browser-API stub is loaded here.

  const environment = jest.requireActual<{ installPuckBrowserApis: typeof installPuckBrowserApis }>(
    './puck-test-environment'
  );
  environment.installPuckBrowserApis();
  return jest.requireActual('@puckeditor/core');
});
jest.mock('@/hooks/use-confirm-modal', () => ({ useConfirmModal: () => ({ show: jest.fn() }) }));
jest.mock('./LandingImageSourceField', () => ({ __esModule: true, default: () => null }));

const renderEditor = (onChange: jest.Mock) =>
  render(
    <PuckLandingPageEditor
      document={defaultLandingPageContent}
      locale="en"
      onLocaleChange={jest.fn()}
      onChange={onChange}
      onEdit={jest.fn()}
      onMove={jest.fn()}
    />
  );

beforeEach(() => {
  const original = console.error;
  jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    // Puck injects CSS nesting unsupported by jsdom 20; ignore only that parser diagnostic.
    if (
      typeof args[0] === 'object' &&
      args[0] !== null &&
      'message' in args[0] &&
      args[0].message === 'Could not parse CSS stylesheet'
    ) {
      return;
    }
    original(...args);
  });
});
afterEach(() => {
  jest.restoreAllMocks();
});

it('uses one inspector and keeps the preview separate from the editor controls', async () => {
  renderEditor(jest.fn());
  // Puck stays visibility:hidden in jsdom because it cannot measure a real viewport.
  expect(screen.getByLabelText('Page preview').tagName).toBe('SECTION');
  expect(screen.getByLabelText('Properties').tagName).toBe('ASIDE');
  expect(screen.queryByText('Publish', { selector: 'button' })).toBeNull();
  expect(screen.getAllByText('Undo', { selector: 'button' })).toHaveLength(1);
  expect(screen.getByText('Sections', { selector: 'button' })).toBeTruthy();
});

it('switches between compact-screen panels without unmounting the preview', () => {
  renderEditor(jest.fn());
  const frame = screen.getByTitle('Landing page preview');
  const workspace = screen.getByLabelText('Editor panels').parentElement;
  fireEvent.click(screen.getByText('Sections', { selector: 'button' }));
  expect(workspace?.dataset.panel).toBe('sections');
  fireEvent.click(screen.getByText('Properties', { selector: 'button' }));
  expect(workspace?.dataset.panel).toBe('properties');
  fireEvent.click(screen.getByText('Preview', { selector: 'button' }));
  expect(workspace?.dataset.panel).toBe('preview');
  expect(screen.getByTitle('Landing page preview')).toBe(frame);
});

it('opens preview actions from the editor toolbar instead of covering the website header', () => {
  renderEditor(jest.fn());
  const frame = screen.getByTitle<HTMLIFrameElement>('Landing page preview');
  const postMessage = jest.spyOn(frame.contentWindow!, 'postMessage');
  fireEvent.click(screen.getByText('Actions', { selector: 'button' }));
  expect(postMessage).toHaveBeenCalledWith(
    { type: 'meshx-cms-open-actions' },
    window.location.origin
  );
});

it('switches the actual preview viewport without reloading it or changing the draft', () => {
  const onChange = jest.fn();
  renderEditor(onChange);
  const frame = screen.getByTitle<HTMLIFrameElement>('Landing page preview');
  onChange.mockClear();
  expect(frame.style.width).toBe('1280px');

  for (const [device, width] of [
    ['Mobile', '390px'],
    ['Tablet', '768px'],
    ['Desktop', '1280px'],
  ]) {
    const button = screen.getByText(device!, { selector: 'button' });
    fireEvent.click(button);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(frame.style.width).toBe(width);
    expect(screen.getByTitle('Landing page preview')).toBe(frame);
  }
  expect(onChange).not.toHaveBeenCalled();
});

it('records an image drag as one undoable draft change and keeps the preview open', async () => {
  const onChange = jest.fn();
  renderEditor(onChange);
  const frame = screen.getByTitle<HTMLIFrameElement>('Landing page preview');
  const send = (data: unknown) => {
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          source: frame.contentWindow,
          data,
        })
      );
    });
  };
  send({
    type: 'meshx-cms-select-element',
    selection: { id: 'test-image', kind: 'image', fields: {}, values: {} },
  });
  expect(screen.getByLabelText('Editor panels').parentElement?.dataset.panel).toBe('preview');
  send({ type: 'meshx-cms-move', id: 'test-image', x: 40, y: 30 });
  await waitFor(() => {
    expect(onChange.mock.calls.at(-1)?.[0]).toHaveProperty('elements.test-image', { x: 40, y: 30 });
  });
  const undo = screen.getByText<HTMLButtonElement>('Undo', { selector: 'button' });
  await waitFor(() => {
    expect(undo.disabled).toBe(false);
  });
  fireEvent.click(undo);
  await waitFor(() => {
    expect(onChange.mock.calls.at(-1)?.[0]).not.toHaveProperty('elements.test-image');
  });
  fireEvent.click(screen.getByText('Redo', { selector: 'button' }));
  await waitFor(() => {
    expect(onChange.mock.calls.at(-1)?.[0]).toHaveProperty('elements.test-image', { x: 40, y: 30 });
  });
});

it('adds and selects a text section and sends the updated document to the real page canvas', async () => {
  const onChange = jest.fn();
  renderEditor(onChange);
  fireEvent.click(screen.getByText('Add section', { selector: 'button' }));
  const label = await screen.findByText('Text section', { selector: 'span' });
  fireEvent.click(label.closest('button')!);
  await waitFor(() => {
    expect(onChange).toHaveBeenCalled();
  });
  const lastDocument = JSON.stringify(onChange.mock.calls.at(-1)?.[0]);
  expect(lastDocument).toContain('"type":"text"');

  const frame = screen.getByTitle<HTMLIFrameElement>('Landing page preview');
  const postMessage = jest.spyOn(frame.contentWindow!, 'postMessage');
  fireEvent.load(frame);
  const sentDraft = postMessage.mock.calls
    .map(([data]) => JSON.stringify(data))
    .find((message) => message.includes('meshx-cms-draft'));
  expect(sentDraft).toContain('"type":"text"');
});

it('edits a selected header button and undoes/redoes the same draft mutation', async () => {
  const onChange = jest.fn();
  renderEditor(onChange);
  const frame = screen.getByTitle<HTMLIFrameElement>('Landing page preview');
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        source: frame.contentWindow,
        data: {
          type: 'meshx-cms-select-element',
          selection: {
            id: 'header-link-1',
            kind: 'navigation',
            fields: {},
            values: { text: 'Platform', href: '#platform' },
          },
        },
      })
    );
  });

  const destination = await screen.findByLabelText('Destination');
  fireEvent.change(destination, { target: { value: '/new-page' } });
  await waitFor(() => {
    expect(JSON.stringify(onChange.mock.calls.at(-1)?.[0])).toContain('"href":"/new-page"');
  });

  // Jsdom has no layout, so Puck's canvas retains its initial hidden viewport state.
  const undo = screen.getByText<HTMLButtonElement>('Undo', { selector: 'button' });
  await waitFor(() => {
    expect(undo.disabled).toBe(false);
  });
  fireEvent.click(undo);
  await waitFor(() => {
    expect(screen.getByLabelText<HTMLInputElement>('Destination').value).toBe('#platform');
  });

  const redo = screen.getByText<HTMLButtonElement>('Redo', { selector: 'button' });
  fireEvent.click(redo);
  await waitFor(() => {
    expect(screen.getByLabelText<HTMLInputElement>('Destination').value).toBe('/new-page');
  });
});

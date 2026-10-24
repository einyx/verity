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

it('adds and selects a text section and sends the updated document to the real page canvas', async () => {
  const onChange = jest.fn();
  renderEditor(onChange);
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

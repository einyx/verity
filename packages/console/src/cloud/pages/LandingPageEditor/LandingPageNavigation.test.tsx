import { defaultLandingPageContent } from '@logto/schemas';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import PuckLandingPageEditor from './PuckLandingPageEditor';
import type { installPuckBrowserApis } from './puck-test-environment';

jest.mock('@puckeditor/core/puck.css', () => ({}));
jest.mock('@puckeditor/core', () => {
  const environment = jest.requireActual<{ installPuckBrowserApis: typeof installPuckBrowserApis }>(
    './puck-test-environment'
  );
  environment.installPuckBrowserApis();
  return jest.requireActual('@puckeditor/core');
});
jest.mock('@/hooks/use-confirm-modal', () => ({
  useConfirmModal: () => ({ show: async () => [true] }),
}));
jest.mock('./LandingImageSourceField', () => ({ __esModule: true, default: () => null }));

const sectionOfType = (type: string) => {
  const section = defaultLandingPageContent.sections.find((candidate) => candidate.type === type);
  if (!section) {
    throw new Error(`Missing default section ${type}`);
  }
  return section;
};

const document = {
  ...defaultLandingPageContent,
  sections: [
    sectionOfType('hero'),
    {
      id: 'custom-proof',
      type: 'text' as const,
      heading: 'Custom proof',
      body: 'Supporting copy.',
    },
    sectionOfType('platform'),
    sectionOfType('closingCta'),
  ],
};

const renderEditor = (onChange = jest.fn<void, [unknown]>()) => {
  render(
    <PuckLandingPageEditor
      document={document}
      locale="en"
      onLocaleChange={jest.fn()}
      onChange={onChange}
      onEdit={jest.fn()}
      onMove={jest.fn()}
    />
  );
  return onChange;
};

const sectionButtons = () =>
  within(screen.getByLabelText('Page section order')).getAllByLabelText(/^Edit /);
const sectionOrder = () => sectionButtons().map((button) => button.getAttribute('aria-label'));

beforeEach(() => {
  const original = console.error;
  jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    // Puck injects CSS nesting unsupported by jsdom 20; retain all other diagnostics.
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

it('lists only present sections together in their actual page order, without an added-section group', () => {
  renderEditor();
  expect(sectionOrder()).toEqual([
    'Edit Hero',
    'Edit Custom proof',
    'Edit Platform',
    'Edit Closing call to action',
  ]);
  expect(screen.queryByText('Added sections')).toBeNull();
  expect(screen.queryByText('Missing layer')).toBeNull();
});

it('moves a built-in section across an added section and preserves its selection and undo history', async () => {
  const onChange = renderEditor();
  fireEvent.click(screen.getByLabelText('Edit Platform'));
  fireEvent.click(screen.getByLabelText('Move Platform up'));
  await waitFor(() => {
    expect(sectionOrder()).toEqual([
      'Edit Hero',
      'Edit Platform',
      'Edit Custom proof',
      'Edit Closing call to action',
    ]);
  });
  expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({
    sections: [
      { id: document.sections[0]?.id },
      { id: document.sections[2]?.id },
      { id: 'custom-proof' },
      { id: document.sections[3]?.id },
    ],
  });
  expect(screen.getByLabelText('Edit Platform').getAttribute('aria-current')).toBe('location');
  const undo = screen.getByText<HTMLButtonElement>('Undo', { selector: 'button' });
  await waitFor(() => {
    expect(undo.disabled).toBe(false);
  });
  fireEvent.click(undo);
  await waitFor(() => {
    expect(sectionOrder()).toEqual([
      'Edit Hero',
      'Edit Custom proof',
      'Edit Platform',
      'Edit Closing call to action',
    ]);
  });
});

it('lets both required sections move freely while keeping their deletion protected', async () => {
  renderEditor();
  fireEvent.keyDown(screen.getByLabelText('Reorder Closing call to action'), { key: 'Home' });
  await waitFor(() => {
    expect(sectionOrder()[0]).toBe('Edit Closing call to action');
  });
  fireEvent.keyDown(screen.getByLabelText('Reorder Hero'), { key: 'End' });
  await waitFor(() => {
    expect(sectionOrder().at(-1)).toBe('Edit Hero');
  });
  expect(screen.queryByLabelText('Remove Hero')).toBeNull();
  expect(screen.queryByLabelText('Remove Closing call to action')).toBeNull();
});

it('keeps the selected section when an earlier neighboring section is removed', async () => {
  renderEditor();
  fireEvent.click(screen.getByLabelText('Edit Platform'));
  fireEvent.click(screen.getByLabelText('Remove Custom proof'));
  await waitFor(() => {
    expect(screen.queryByLabelText('Edit Custom proof')).toBeNull();
  });
  expect(screen.getByLabelText('Edit Platform').getAttribute('aria-current')).toBe('location');
});

it('allows an added section to be dragged across built-in sections and sends that order to the preview', async () => {
  const onChange = renderEditor();
  const values = new Map<string, string>();
  const dataTransfer = {
    setData: (type: string, value: string) => values.set(type, value),
    getData: (type: string) => values.get(type) ?? '',
    effectAllowed: 'none',
    dropEffect: 'none',
  };
  fireEvent.dragStart(screen.getByLabelText('Reorder Custom proof'), { dataTransfer });
  const target = screen.getByLabelText('Edit Closing call to action').closest('li');
  expect(target).not.toBeNull();
  fireEvent.dragOver(target!, { dataTransfer });
  fireEvent.drop(target!, { dataTransfer });
  await waitFor(() => {
    expect(sectionOrder()).toEqual([
      'Edit Hero',
      'Edit Platform',
      'Edit Closing call to action',
      'Edit Custom proof',
    ]);
  });
  expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({
    sections: [
      { id: document.sections[0]?.id },
      { id: document.sections[2]?.id },
      { id: document.sections[3]?.id },
      { id: 'custom-proof' },
    ],
  });
  const frame = screen.getByTitle<HTMLIFrameElement>('Landing page preview');
  const postMessage = jest.spyOn(frame.contentWindow!, 'postMessage');
  fireEvent.load(frame);
  expect(
    postMessage.mock.calls.some(
      ([message]) =>
        typeof message === 'object' &&
        message !== null &&
        'doc' in message &&
        JSON.stringify(message.doc) === JSON.stringify(onChange.mock.calls.at(-1)?.[0])
    )
  ).toBe(true);
});

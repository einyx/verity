import { defaultLandingPageContent } from '@logto/schemas';
import { fireEvent, render, screen } from '@testing-library/react';

import HistoryPreview from './HistoryPreview';

const props = {
  version: {
    version: 1,
    document: defaultLandingPageContent,
    publishedBy: 'Admin',
    createdAt: 'Today',
  },
  currentDraft: { ...defaultLandingPageContent, demoChat: { enabled: false } },
  publishedVersion: 3,
  onRestore: jest.fn(),
  onClose: jest.fn(),
};
beforeEach(() => {
  jest.clearAllMocks();
});

it('labels a historical preview separately from the published website without editing the current draft', () => {
  render(<HistoryPreview {...props} />);
  expect(screen.getByText('Previewing version 1')).toBeTruthy();
  expect(screen.getByText(/Website: version 3/)).toBeTruthy();
  expect(screen.getByTitle('Proposed landing page preview')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Return to current draft' }));
  expect(props.onClose).toHaveBeenCalledTimes(1);
  expect(props.onRestore).not.toHaveBeenCalled();
});

it('reviews restoration and changes only the working draft after explicit confirmation', () => {
  render(<HistoryPreview {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Restore to draft' }));
  expect(props.onRestore).not.toHaveBeenCalled();
  expect(screen.getByText(/The website will not change/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Restore version 1 to draft' }));
  expect(props.onRestore).toHaveBeenCalledWith(defaultLandingPageContent);
});

it('does not overwrite newer edits if the working draft changes during restore review', () => {
  const { rerender } = render(<HistoryPreview {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Restore to draft' }));
  rerender(
    <HistoryPreview
      {...props}
      currentDraft={{ ...props.currentDraft, copy: { hero: { en: 'New typing' } } }}
    />
  );
  expect(
    screen.getByRole('button', { name: 'Restore version 1 to draft' }).hasAttribute('disabled')
  ).toBe(true);
});

it('returns keyboard focus to Restore to draft when restoration review is cancelled', () => {
  render(<HistoryPreview {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Restore to draft' }));
  const cancel = screen.getByRole('button', { name: 'Cancel restoration' });
  cancel.focus();
  fireEvent.click(cancel);
  expect(window.document.activeElement).toBe(
    screen.getByRole('button', { name: 'Restore to draft' })
  );
});

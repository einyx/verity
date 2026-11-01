import { fireEvent, render, screen } from '@testing-library/react';

import PublicationReview from './PublicationReview';

const props = {
  snapshot: { heading: 'New', demoChat: { enabled: false } },
  currentDraft: { heading: 'New', demoChat: { enabled: false } },
  published: { heading: 'Old', demoChat: { enabled: true } },
  publishedVersion: 1,
  isBusy: false,
  onConfirm: jest.fn(),
  onCancel: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
});

it('explains the live replacement and chat setting before any write', () => {
  render(<PublicationReview {...props} />);
  expect(screen.getByRole('dialog', { name: 'Review publication' })).toBeTruthy();
  expect(screen.getByText(/replace website version 1/)).toBeTruthy();
  expect(screen.getByText('Demo chat: hidden')).toBeTruthy();
  expect(props.onConfirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(props.onCancel).toHaveBeenCalledTimes(1);
  expect(props.onConfirm).not.toHaveBeenCalled();
});

it('invalidates a reviewed draft if edits change after review opens', () => {
  render(<PublicationReview {...props} currentDraft={{ heading: 'Newer edit' }} />);
  expect(
    screen.getByRole('button', { name: 'Publish reviewed draft' }).hasAttribute('disabled')
  ).toBe(true);
  expect(screen.getByRole('alert').textContent).toContain('changed since this review');
});

it('requires confirmation when restoring history and explains that the draft is preserved', () => {
  render(<PublicationReview {...props} restoreVersion={2} />);
  expect(screen.getByText(/Your editing draft will not change/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Make version 2 live' }));
  expect(props.onConfirm).toHaveBeenCalledTimes(1);
});

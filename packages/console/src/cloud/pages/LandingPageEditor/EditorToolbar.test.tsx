import { defaultLandingPageContent } from '@logto/schemas';
import { fireEvent, render, screen, within } from '@testing-library/react';

import EditorToolbar from './EditorToolbar';

jest.mock('@/consts/env', () => ({ isDevFeaturesEnabled: true }));

const props = {
  draft: defaultLandingPageContent,
  status: 'Draft saved',
  publishedVersion: 1,
  versions: [
    { version: 1, document: defaultLandingPageContent, publishedBy: 'Admin', createdAt: 'Today' },
  ],
  hasVersionsError: false,
  isBusy: false,
  onDraftChange: jest.fn(),
  onSave: jest.fn(),
  onPublish: jest.fn(),
  onRollback: jest.fn(),
  onEditWithAi: jest.fn(),
  onPreviewVersion: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
});

it('moves the draft-only demo chat setting into Page settings', () => {
  render(<EditorToolbar {...props} />);
  fireEvent.click(screen.getByText('Page settings', { selector: 'summary' }));
  const settings = screen.getByRole('region', { name: 'Page settings' });
  expect(within(settings).getByText('Takes effect when published.')).toBeTruthy();
  fireEvent.click(within(settings).getByRole('checkbox', { name: 'Show demo chat' }));
  expect(props.onDraftChange).toHaveBeenCalledWith(
    expect.objectContaining({ demoChat: { enabled: false } })
  );
  expect(props.onSave).not.toHaveBeenCalled();
  expect(props.onPublish).not.toHaveBeenCalled();
});

it('names history and labels the currently published version', () => {
  render(<EditorToolbar {...props} />);
  expect(screen.queryByText(/^Versions/)).toBeNull();
  fireEvent.click(screen.getByText('History', { selector: 'summary' }));
  expect(screen.getByText('Published')).toBeTruthy();
  expect(screen.getByText('Website: version 1')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Publish' })).toBeTruthy();
});

it('offers version preview separately from making a version live', () => {
  render(<EditorToolbar {...props} />);
  fireEvent.click(screen.getByText('History', { selector: 'summary' }));
  fireEvent.click(screen.getByRole('button', { name: 'Preview version 1' }));
  expect(props.onPreviewVersion).toHaveBeenCalledWith(1);
  expect(props.onRollback).not.toHaveBeenCalled();
  expect(props.onSave).not.toHaveBeenCalled();
});

it('opens AI editing only when requested and keeps saving explicit', () => {
  render(<EditorToolbar {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit with AI' }));
  expect(props.onEditWithAi).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  expect(props.onSave).toHaveBeenCalledTimes(1);
});

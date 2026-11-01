import { defaultLandingPageContent, type LandingPageResponse } from '@logto/schemas';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useLandingPage } from '@/cloud/hooks/use-landing-page';
import useManageLandingPageGuard from '@/cloud/hooks/use-manage-landing-page-guard';

import LandingPageEditor from './index';

jest.mock('@/cloud/hooks/use-landing-page', () => ({
  useLandingPage: jest.fn(),
}));
jest.mock('@/consts/env', () => ({ isDevFeaturesEnabled: true }));
jest.mock('@/cloud/hooks/use-manage-landing-page-guard', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('./PuckLandingPageEditor', () => ({
  __esModule: true,
  default: () => <div data-testid="puck-landing-page-editor">Page canvas</div>,
}));
const document = {
  ...defaultLandingPageContent,
  sections: defaultLandingPageContent.sections.map((section) =>
    section.type === 'hero' ? { ...section, lede: 'A useful introduction' } : section
  ),
};

const savedAt = '2026-10-25T10:00:00.000Z';

const landingPage = {
  data: { draft: document, published: null, publishedVersion: null } satisfies LandingPageResponse,
  error: undefined,
  isLoading: false,
  saveDraft: jest.fn().mockResolvedValue({ updatedAt: savedAt }),
  publish: jest.fn().mockResolvedValue(undefined),
  rollback: jest.fn().mockResolvedValue(undefined),
  generateEdit: jest.fn().mockResolvedValue({ ...document, sections: [] }),
  listVersions: jest.fn().mockResolvedValue([]),
  sendChat: jest.fn().mockResolvedValue({ reply: 'Hello', submitted: false }),
  refresh: jest.fn().mockResolvedValue(undefined),
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useManageLandingPageGuard).mockReturnValue(async () => true);
  jest.mocked(useLandingPage).mockReturnValue(landingPage);
});

it('previews an AI suggestion without saving or publishing until the admin chooses', async () => {
  render(<LandingPageEditor />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit with AI' }));
  const input = await screen.findByRole('textbox', { name: 'Describe the change' });
  fireEvent.change(input, { target: { value: 'Make the hero lede shorter' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));

  await waitFor(() => {
    expect(landingPage.generateEdit).toHaveBeenCalledWith(
      expect.stringContaining('Make the hero lede shorter'),
      document
    );
  });
  expect(landingPage.saveDraft).not.toHaveBeenCalled();
  expect(landingPage.publish).not.toHaveBeenCalled();

  fireEvent.click(await screen.findByRole('button', { name: 'Apply to draft' }));

  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => {
    expect(landingPage.saveDraft).toHaveBeenCalledWith({ ...document, sections: [] });
  });
});

it('renders the Puck page canvas and keeps Demo chat settings above it', async () => {
  render(<LandingPageEditor />);

  fireEvent.click(await screen.findByText('Page settings', { selector: 'summary' }));
  const demoChatSection = await screen.findByRole('region', { name: 'Page settings' });
  const puckEditor = await screen.findByTestId('puck-landing-page-editor');
  expect(demoChatSection.compareDocumentPosition(puckEditor)).toBeGreaterThan(0);
  expect(puckEditor.textContent).toBe('Page canvas');

  fireEvent.click(screen.getByRole('checkbox', { name: 'Show demo chat' }), {});

  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

  await waitFor(() => {
    expect(landingPage.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({ demoChat: { enabled: false } })
    );
  });
});

it('publishes against the saved draft and warns when another editor changed it first', async () => {
  landingPage.publish.mockRejectedValueOnce({ status: 409 });
  render(<LandingPageEditor />);

  const publishButton = await screen.findByRole('button', { name: 'Publish' });
  fireEvent.click(publishButton);
  expect(landingPage.saveDraft).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Publish reviewed draft' }));

  await waitFor(() => {
    expect(landingPage.publish).toHaveBeenCalledWith(savedAt);
  });
  expect(await screen.findByText(/The draft changed while you were editing/)).toBeTruthy();
  expect(landingPage.refresh).toHaveBeenCalled();
});

it('cancels publication review without saving or publishing', async () => {
  render(<LandingPageEditor />);
  fireEvent.click(await screen.findByRole('button', { name: 'Publish' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(landingPage.saveDraft).not.toHaveBeenCalled();
  expect(landingPage.publish).not.toHaveBeenCalled();
});

it('does not publish when saving the reviewed snapshot fails', async () => {
  landingPage.saveDraft.mockRejectedValueOnce(new Error('Could not save draft'));
  render(<LandingPageEditor />);
  fireEvent.click(await screen.findByRole('button', { name: 'Publish' }));
  fireEvent.click(screen.getByRole('button', { name: 'Publish reviewed draft' }));
  expect(await screen.findByText('Could not save draft')).toBeTruthy();
  expect(landingPage.publish).not.toHaveBeenCalled();
});

it('separates draft save status from website status and retains unsaved edits after a failed save', async () => {
  landingPage.saveDraft.mockRejectedValueOnce(new Error('Save unavailable'));
  render(<LandingPageEditor />);
  expect(await screen.findByText('Draft saved')).toBeTruthy();
  expect(screen.getByText('Website: not published')).toBeTruthy();
  fireEvent.click(screen.getByText('Page settings', { selector: 'summary' }));
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByText('Unsaved changes')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  expect(await screen.findByText('Save unavailable')).toBeTruthy();
  expect(screen.getByText('Unsaved changes')).toBeTruthy();
});

it('announces saving and keeps edits made during a save unsaved', async () => {
  const resolveSaved = jest.fn<void, [{ updatedAt: string }]>();
  const saved = new Promise<{ updatedAt: string }>((resolve) => {
    resolveSaved.mockImplementation(resolve);
  });
  landingPage.saveDraft.mockReturnValueOnce(saved);
  render(<LandingPageEditor />);
  fireEvent.click(await screen.findByText('Page settings', { selector: 'summary' }));
  const checkbox = await screen.findByRole('checkbox');
  fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  expect(screen.getByText('Saving…')).toBeTruthy();
  fireEvent.click(checkbox);
  await act(async () => {
    resolveSaved({ updatedAt: savedAt });
  });
  expect(screen.getByText('Unsaved changes')).toBeTruthy();
});

it('keeps the canvas visible if a background refresh fails', async () => {
  jest.mocked(useLandingPage).mockReturnValue({ ...landingPage, error: new Error('Offline') });
  render(<LandingPageEditor />);
  expect(await screen.findByTestId('puck-landing-page-editor')).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain('Could not refresh');
});

it('offers a saved-draft review instead of overwriting unsaved local edits', async () => {
  const { rerender } = render(<LandingPageEditor />);
  fireEvent.click(await screen.findByText('Page settings', { selector: 'summary' }));
  fireEvent.click(screen.getByRole('checkbox'));
  const incoming = { ...document, sections: [] };
  jest
    .mocked(useLandingPage)
    .mockReturnValue({ ...landingPage, data: { ...landingPage.data, draft: incoming } });
  rerender(<LandingPageEditor />);
  expect(await screen.findByRole('region', { name: 'Saved draft update' })).toBeTruthy();
  expect(screen.getByText('Unsaved changes')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Load saved draft' }));
  expect(screen.getByText('Draft saved')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => {
    expect(landingPage.saveDraft).toHaveBeenCalledWith(incoming);
  });
});

it('previews and restores a historical version without changing the website or losing the mounted editor', async () => {
  const older = { ...document, demoChat: { enabled: false } };
  landingPage.listVersions.mockResolvedValueOnce([
    { version: 1, document: older, publishedBy: 'Admin', createdAt: 'Today' },
  ]);
  render(<LandingPageEditor />);
  const canvas = await screen.findByTestId('puck-landing-page-editor');
  fireEvent.click(screen.getByText('History', { selector: 'summary' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Preview version 1' }));
  expect(screen.getByText('Previewing version 1')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Publish' }).hasAttribute('disabled')).toBe(true);
  expect(landingPage.saveDraft).not.toHaveBeenCalled();
  expect(landingPage.rollback).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Restore to draft' }));
  fireEvent.click(screen.getByRole('button', { name: 'Restore version 1 to draft' }));
  expect(window.document.activeElement).toBe(screen.getByText('History', { selector: 'summary' }));
  expect(screen.getByTestId('puck-landing-page-editor')).toBe(canvas);
  expect(screen.getByText('Unsaved changes')).toBeTruthy();
  expect(landingPage.publish).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => {
    expect(landingPage.saveDraft).toHaveBeenCalledWith(older);
  });
});

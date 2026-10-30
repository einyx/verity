import { defaultLandingPageContent, type LandingPageResponse } from '@logto/schemas';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useLandingPage } from '@/cloud/hooks/use-landing-page';
import useManageLandingPageGuard from '@/cloud/hooks/use-manage-landing-page-guard';

import LandingPageEditor from './index';

jest.mock('@/cloud/hooks/use-landing-page', () => ({
  useLandingPage: jest.fn(),
}));
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
  const input = await screen.findByRole('textbox', { name: 'Ask AI to edit this draft' });
  fireEvent.change(input, { target: { value: 'Make the hero lede shorter' } });
  fireEvent.click(screen.getByRole('button', { name: 'Suggest edit' }));

  await waitFor(() => {
    expect(landingPage.generateEdit).toHaveBeenCalledWith('Make the hero lede shorter', document);
  });
  expect(landingPage.saveDraft).not.toHaveBeenCalled();
  expect(landingPage.publish).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => {
    expect(landingPage.saveDraft).toHaveBeenCalledWith({ ...document, sections: [] });
  });
});

it('renders the Puck page canvas and keeps Demo chat settings above it', async () => {
  render(<LandingPageEditor />);

  const demoChatSection = await screen.findByRole('region', { name: 'Demo chat content' });
  const puckEditor = await screen.findByTestId('puck-landing-page-editor');
  expect(demoChatSection.compareDocumentPosition(puckEditor)).toBeGreaterThan(0);
  expect(puckEditor.textContent).toBe('Page canvas');

  fireEvent.click(screen.getByRole('checkbox', { name: /Demo chat on the site/ }), {});

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

  const publishButton = await screen.findByRole('button', { name: 'Publish to website' });
  fireEvent.click(publishButton);
  fireEvent.click(publishButton);

  await waitFor(() => {
    expect(landingPage.publish).toHaveBeenCalledWith(savedAt);
  });
  expect(await screen.findByText(/The draft changed while you were editing/)).toBeTruthy();
  expect(landingPage.refresh).toHaveBeenCalled();
});

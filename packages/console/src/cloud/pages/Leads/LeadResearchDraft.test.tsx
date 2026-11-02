import { fireEvent, render, screen } from '@testing-library/react';

import type { LandingLead } from '@/cloud/hooks/use-landing-leads';

import LeadResearchDraft from './LeadResearchDraft';

jest.mock('@/ds-components/Button', () => ({
  __esModule: true,
  default: ({
    title,
    onClick,
    isLoading,
  }: {
    title: React.ReactNode;
    onClick: () => void;
    isLoading: boolean;
  }) => (
    <button disabled={isLoading} onClick={onClick}>
      {title}
    </button>
  ),
}));
jest.mock('@/ds-components/DangerousRaw', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

const lead: LandingLead = {
  id: 'lead-1',
  sessionId: 'session-1',
  lead: {
    firstName: 'Ada',
    lastName: 'Lovelace',
    company: 'Analytical Engines',
    email: 'ada@example.com',
  },
  emailStatus: 'pending',
  status: 'new',
  companyProfile: null,
  createdAt: '2026-10-21T12:00:00.000Z',
};

it('requests source-cited research for the selected lead and renders an unsent draft', async () => {
  const onResearch = jest.fn(async (_sessionId: string, _provider: 'autoclaw' | 'claude') => ({
    findings: [
      {
        summary: 'The company provides identity infrastructure.',
        sourceUrl: 'https://example.com/about',
        retrievedAt: '2026-10-21T12:00:00.000Z',
      },
    ],
    draft: 'Hi Ada, saw your work at Analytical Engines.',
  }));
  render(<LeadResearchDraft lead={lead} onResearch={onResearch} />);

  fireEvent.click(screen.getByRole('button', { name: 'Research with Claude Code' }));

  expect(onResearch).toHaveBeenCalledWith('session-1', 'claude');
  expect(await screen.findByText('The company provides identity infrastructure.')).toBeTruthy();
  const sourceLink = screen.getByRole('link', { name: 'Source' });
  expect(sourceLink.getAttribute('href')).toBe('https://example.com/about');
  const draft = screen.getByLabelText('Outreach draft');
  expect(draft instanceof HTMLTextAreaElement).toBe(true);
  if (draft instanceof HTMLTextAreaElement) {
    expect(draft.value).toBe('Hi Ada, saw your work at Analytical Engines.');
  }
  expect(screen.getByText(/not sent or saved/i)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /send/i })).toBeNull();
});

it('shows a recoverable error when AutoClaw research fails', async () => {
  const onResearch = jest.fn(async () => {
    throw new Error('Service unavailable');
  });
  render(<LeadResearchDraft lead={lead} onResearch={onResearch} />);

  fireEvent.click(screen.getByRole('button', { name: 'Research with Claude Code' }));

  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toMatch(/research failed/i);
});

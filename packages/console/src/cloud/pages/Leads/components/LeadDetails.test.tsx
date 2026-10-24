import { fireEvent, render, screen } from '@testing-library/react';

import { type LandingLead } from '@/cloud/hooks/use-landing-leads';

import LeadDetails, { type LeadDetailsProps, readProfile } from './LeadDetails';

jest.mock('@/consts/env', () => ({ isCloud: false, isDevFeaturesEnabled: true }));
jest.mock('@/components/FeatureTag', () => ({ CombinedAddOnAndFeatureTag: () => null }));
jest.mock('@/hooks/use-theme', () => ({ __esModule: true, default: () => 'light' }));

const lead: LandingLead = {
  id: 'lead-1',
  sessionId: 'session-1',
  lead: { firstName: 'Sarah', lastName: 'Chen', email: 'sarah@acme.com', company: 'Acme Corp' },
  emailStatus: 'sent',
  status: 'new',
  createdAt: '2026-10-23T10:00:00.000Z',
};

const props = (): LeadDetailsProps => ({
  lead,
  profile: readProfile(lead),
  hasTranscriptFailed: false,
  isAssistLoading: false,
  hasDemoFailed: false,
  notes: 'Asked for a technical deep-dive',
  tags: 'priority',
  onNotesChange: jest.fn(),
  onTagsChange: jest.fn(),
  onSave: jest.fn(),
  onStageChange: jest.fn(),
  onRunAssist: jest.fn(),
  onDecideDemo: jest.fn(),
  onDownloadBrief: jest.fn(),
  onDownloadSlides: jest.fn(),
  hasSaveFailed: false,
  hasFileFailed: false,
  hasAssistFailed: false,
});

it('shows identity, controlled saved values and the missing company profile copy', () => {
  render(<LeadDetails {...props()} />);
  expect(screen.getByText('Sarah Chen, Acme Corp')).toBeTruthy();
  expect(screen.getByLabelText('Sales notes')).toHaveProperty(
    'value',
    'Asked for a technical deep-dive'
  );
  expect(screen.getByLabelText('Tags')).toHaveProperty('value', 'priority');
  expect(
    screen.getByText('No company profile yet. The company website could not be read.')
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Book a meeting' })).toBeNull();
});

it('passes optional unknown budget data to the internal panel without changing lead controls', () => {
  const budgetLead: LandingLead = {
    ...lead,
    companyProfile: { summary: 'Still available', budgetAssessment: { inventedBudget: 999 } },
  };
  const profile = readProfile(budgetLead);
  expect(profile.budgetAssessment).toEqual({ inventedBudget: 999 });
  render(<LeadDetails {...props()} lead={budgetLead} profile={profile} />);
  expect(screen.getByRole('region', { name: 'Internal budget advisory' })).toBeTruthy();
  expect(screen.getByText('No valid budget assessment yet.')).toBeTruthy();
  expect(screen.getByText('Still available')).toBeTruthy();
  expect(screen.getByLabelText('Sales notes')).toHaveProperty('value', props().notes);
});

it('groups labeled fields separately from consistently sized action rows', () => {
  render(<LeadDetails {...props()} />);
  const status = screen.getByLabelText('Pipeline status');
  expect(status.parentElement?.className).toBe('field');
  expect(status.closest('.actions')).toBeNull();
  expect(screen.getByLabelText('Tags').parentElement?.className).toBe('field');
  expect(screen.getByLabelText('Sales notes').parentElement?.className).toBe('field');
  expect(screen.getByRole('button', { name: 'AI lead assist' }).parentElement?.className).toBe(
    'actions'
  );
});

it('delegates edits and every existing action without owning state', () => {
  const handlers = props();
  const onBookMeeting = jest.fn();
  render(
    <LeadDetails
      {...handlers}
      demoRequest={{ name: 'demo', email: lead.lead.email, phase: 'Pending', tenant: 'tenant' }}
      onBookMeeting={onBookMeeting}
    />
  );
  fireEvent.change(screen.getByLabelText('Sales notes'), { target: { value: 'Updated' } });
  fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'sales, priority' } });
  fireEvent.change(screen.getByLabelText('Pipeline status'), { target: { value: 'provisioned' } });
  expect(handlers.onNotesChange).toHaveBeenCalledWith('Updated');
  expect(handlers.onTagsChange).toHaveBeenCalledWith('sales, priority');
  expect(handlers.onStageChange).toHaveBeenCalledWith('provisioned');
  for (const [name, handler] of [
    ['Save notes and tags', handlers.onSave],
    ['AI lead assist', handlers.onRunAssist],
    ['Download meeting brief (PDF)', handlers.onDownloadBrief],
    ['Download meeting slides (PPTX)', handlers.onDownloadSlides],
    ['Book a meeting', onBookMeeting],
  ] as const) {
    fireEvent.click(screen.getByRole('button', { name }));
    expect(handler).toHaveBeenCalledTimes(1);
  }
  fireEvent.click(screen.getByRole('button', { name: 'Approve demo' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reject demo' }));
  expect(handlers.onDecideDemo).toHaveBeenNthCalledWith(1, 'approve');
  expect(handlers.onDecideDemo).toHaveBeenNthCalledWith(2, 'reject');
  expect(screen.getByText('demo · Pending · tenant')).toBeTruthy();
});

it('preserves error copy and hides decisions for completed demo requests', () => {
  render(
    <LeadDetails
      {...props()}
      hasSaveFailed
      hasFileFailed
      hasAssistFailed
      hasDemoFailed
      hasTranscriptFailed
      demoRequest={{ name: 'demo', email: lead.lead.email, phase: 'Approved' }}
    />
  );
  for (const text of [
    'The file could not be created.',
    'Lead changes could not be saved.',
    'AI assistance is unavailable. Check the AI configuration and try again.',
    'The decision could not be saved.',
    'The conversation could not be loaded.',
  ]) {
    expect(screen.getByText(text)).toBeTruthy();
  }
  expect(screen.queryByRole('button', { name: 'Approve demo' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Reject demo' })).toBeNull();
});

it('reads only well-typed profile fields while preserving source and insight values', () => {
  expect(
    readProfile({
      ...lead,
      companyProfile: {
        summary: 'Company',
        sources: ['source', 1],
        conversation: { tone: 'Warm', outcomes: ['Demo', null], nextSteps: ['Follow up'] },
      },
    })
  ).toEqual({
    summary: 'Company',
    sources: ['source'],
    tone: 'Warm',
    outcomes: ['Demo'],
    nextSteps: ['Follow up'],
  });
});

it('renders optional qualification, company insights and AI assistance in the original order', () => {
  const qualifiedLead: LandingLead = {
    ...lead,
    status: 'qualified',
    lead: {
      ...lead.lead,
      role: 'CTO',
      industry: 'Software',
      contactMethod: 'email',
      contactDetail: 'Work address',
      decision: 'Technical demo',
    },
    companyProfile: {
      summary: 'An engineering company',
      sources: ['https://acme.com'],
      conversation: {
        tone: 'Curious',
        outcomes: ['Qualified opportunity'],
        nextSteps: ['Show SSO'],
      },
    },
  };
  render(
    <LeadDetails
      {...props()}
      lead={qualifiedLead}
      profile={readProfile(qualifiedLead)}
      assist={{
        qualification: 'high',
        summary: 'Strong fit',
        rationale: ['Needs SSO'],
        suggestedNextSteps: ['Schedule demo'],
        followUpDraft: 'Thanks Sarah',
      }}
    />
  );
  for (const text of [
    'CTO',
    'Software',
    'email: Work address',
    'Technical demo',
    'Conversation insights suggest covering the following topics.',
    'An engineering company',
    'Sources: https://acme.com',
    'Qualified opportunity',
    'AI lead assist · high fit',
    'Strong fit',
    'Needs SSO',
    'Schedule demo',
    'Thanks Sarah',
  ]) {
    expect(screen.getByText(text)).toBeTruthy();
  }
  expect(screen.getAllByText('Show SSO')).toHaveLength(2);
  expect(screen.getAllByRole('option').map((option) => option.getAttribute('value'))).toEqual([
    'new',
    'contacted',
    'qualified',
    'demo_requested',
    'approved',
    'provisioned',
    'closed',
    'rejected',
  ]);
  expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
    'AI lead assist',
    'Download meeting brief (PDF)',
    'Download meeting slides (PPTX)',
    'Save notes and tags',
  ]);
});

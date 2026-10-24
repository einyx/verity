import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';

import LeadsList from './LeadsList';

jest.mock('@/hooks/use-tenant-pathname', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/consts/env', () => ({ isCloud: false, isDevFeaturesEnabled: true }));
jest.mock('@/components/FeatureTag', () => ({ CombinedAddOnAndFeatureTag: () => null }));

const props: ComponentProps<typeof LeadsList> = {
  leads: [
    {
      id: 'ada',
      sessionId: 'session',
      lead: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        company: 'Analytical',
      },
      status: 'qualified',
      emailStatus: 'sent',
      notes: 'Security',
      tags: ['Priority'],
      createdAt: '2026-10-20T10:00:00Z',
    },
  ],
  page: 1,
  totalCount: 1,
  search: '',
  stage: '',
  tag: '',
  isLoading: false,
  isFailed: false,
  onSearchChange: jest.fn(),
  onStageChange: jest.fn(),
  onTagChange: jest.fn(),
  onPageChange: jest.fn(),
  onSelectLead: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
});

it('preserves native pressed queue cards with saved fields and correct match count', () => {
  render(<LeadsList {...props} selectedLeadId="ada" />);
  const button = screen.getByRole('button', { name: /Ada Lovelace/ });
  expect(button.tagName).toBe('BUTTON');
  expect(button.getAttribute('aria-pressed')).toBe('true');
  expect(button.textContent).toContain('Tags: Priority');
  expect(button.textContent).toContain('Email: sent');
  expect(screen.getByText('1 matching')).toBeTruthy();
  fireEvent.click(button);
  expect(props.onSelectLead).toHaveBeenCalledWith(props.leads[0]);
});

it.each(['search', 'stage', 'tag'] as const)(
  'distinguishes empty queues from no matches for %s',
  (filter) => {
    render(<LeadsList {...props} leads={[]} totalCount={0} {...{ [filter]: 'missing' }} />);
    expect(screen.getByRole('status').textContent).toBe('No leads match your filters.');
  }
);

it('offers all stages and forwards filters and one-based pages without client filtering', () => {
  render(<LeadsList {...props} totalCount={41} />);
  expect(screen.getByRole('option', { name: 'Provisioned' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Search leads'), { target: { value: 'Ada' } });
  fireEvent.change(screen.getByLabelText('Filter by pipeline status'), {
    target: { value: 'new' },
  });
  fireEvent.change(screen.getByLabelText('Filter by tag'), { target: { value: 'PRIO' } });
  fireEvent.click(screen.getByRole('button', { name: '2' }));
  expect(props.onSearchChange).toHaveBeenCalledWith('Ada');
  expect(props.onStageChange).toHaveBeenCalledWith('new');
  expect(props.onTagChange).toHaveBeenCalledWith('PRIO');
  expect(props.onPageChange).toHaveBeenCalledWith(2);
});

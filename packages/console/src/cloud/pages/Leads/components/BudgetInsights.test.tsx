import { render, screen } from '@testing-library/react';

import BudgetInsights from './BudgetInsights';

const assessment = {
  currency: 'USD',
  demoMonthly: 150,
  bankAnnualPlanningAnchor: 1_500_000,
  bankPeriodAssumption: 'annual, unconfirmed',
  opportunityBudgetStatus: 'not_disclosed',
  indicativeAnnualRange: { low: 1000, base: 2000, high: 3000 },
  confidence: 'medium',
  assessedAt: '2026-10-24T00:00:00.000Z',
  rationale: ['Public scale context'],
  assumptions: ['Scope needs validation'],
  discoveryQuestions: ['Who approves funding?'],
  evidence: [
    { sourceUrl: 'https://example.test/about', quote: 'We serve businesses', signal: 'Scale only' },
  ],
};

it('separates annual advisory vendor pricing from unknown customer funds and fixed references', () => {
  render(<BudgetInsights assessment={assessment} />);
  for (const text of [
    'USD 150/month',
    'Not disclosed',
    'USD 1,000',
    'USD 2,000',
    'USD 3,000',
    'Public scale context',
    'Scope needs validation',
    'Who approves funding?',
  ]) {
    expect(screen.getByText(text)).toBeTruthy();
  }
  expect(screen.getByText(/USD 1,500,000\/year.*UNCONFIRMED/)).toBeTruthy();
  expect(screen.getByText(/not the customer’s confirmed budget or a binding quote/)).toBeTruthy();
  expect(screen.getByText(/medium.*2026-10-24/)).toBeTruthy();
  expect(screen.getByRole('link').getAttribute('href')).toBe('https://example.test/about');
});

it.each([
  undefined,
  {},
  { ...assessment, confidence: 'high' },
  ...[-1, Number.NaN, Number.POSITIVE_INFINITY, 4000].map((low) => ({
    ...assessment,
    indicativeAnnualRange: { low, base: 2000, high: 3000 },
  })),
])('does not invent amounts for malformed or missing payloads', (value) => {
  render(<BudgetInsights assessment={value} />);
  expect(screen.getByText('Not disclosed')).toBeTruthy();
  expect(screen.queryByText('USD 0')).toBeNull();
  expect(screen.queryByText('USD 2,000')).toBeNull();
  expect(screen.getByText('No valid budget assessment yet.')).toBeTruthy();
});

it('handles a valid sparse assessment with no range or evidence', () => {
  render(
    <BudgetInsights assessment={{ ...assessment, indicativeAnnualRange: null, evidence: [] }} />
  );
  expect(screen.getByText('Insufficient evidence or scope for a range.')).toBeTruthy();
  expect(screen.queryByRole('link')).toBeNull();
});

// eslint-disable-next-line no-script-url -- Deliberately unsafe fixture verifies that evidence never creates a script link.
it.each(['javascript:alert(1)', 'http://example.test', 'https://user:pass@example.test'])(
  'never links unsafe evidence URL %s',
  (sourceUrl) => {
    render(
      <BudgetInsights
        assessment={{ ...assessment, evidence: [{ ...assessment.evidence[0], sourceUrl }] }}
      />
    );
    expect(screen.queryByRole('link')).toBeNull();
  }
);

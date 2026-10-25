import { render, screen } from '@testing-library/react';

import BudgetInsights from './BudgetInsights';

const assessment = {
  // Synthetic sentinels: any figure the payload may carry must stay unpublished.
  currency: 'USD',
  demoMonthly: 999,
  bankAnnualPlanningAnchor: 888_888,
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

it('shows the budget status, a hypothetical suggestion and the discovery questions', () => {
  render(<BudgetInsights assessment={assessment} />);
  expect(screen.getByText('Not disclosed')).toBeTruthy();
  expect(screen.getByText(/Hypothetical suggestion for sales/)).toBeTruthy();
  expect(screen.getByText('Who approves funding?')).toBeTruthy();
  expect(screen.getByRole('link').getAttribute('href')).toBe('https://example.test/about');
});

it('never publishes budget figures, ranges, confidence ratings or assessment dates', () => {
  render(<BudgetInsights assessment={assessment} />);
  for (const text of ['Public scale context', 'Scope needs validation']) {
    expect(screen.queryByText(text)).toBeNull();
  }
  expect(screen.queryByText(/USD/)).toBeNull();
  expect(screen.queryByText(/\d/)).toBeNull();
  expect(screen.queryByText(/UNCONFIRMED/)).toBeNull();
  expect(screen.queryByText(/Confidence/)).toBeNull();
  expect(screen.queryByText(/2026-10-24/)).toBeNull();
});

it.each([undefined, {}])('shows no advisory content for a missing or empty payload %j', (value) => {
  render(<BudgetInsights assessment={value} />);
  expect(screen.getByText('Not disclosed')).toBeTruthy();
  expect(screen.getByText('No valid budget assessment yet.')).toBeTruthy();
  expect(screen.queryByText('Who approves funding?')).toBeNull();
});

it('ignores a malformed scenario range without inventing amounts', () => {
  render(
    <BudgetInsights
      assessment={{ ...assessment, indicativeAnnualRange: { low: 3, base: 2, high: 1 } }}
    />
  );
  expect(screen.queryByText(/USD/)).toBeNull();
  expect(screen.getByText('Who approves funding?')).toBeTruthy();
});

it('handles a valid sparse assessment with no evidence', () => {
  render(
    <BudgetInsights assessment={{ ...assessment, indicativeAnnualRange: null, evidence: [] }} />
  );
  expect(screen.queryByRole('link')).toBeNull();
  expect(screen.getByText('Who approves funding?')).toBeTruthy();
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

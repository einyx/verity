import { render, screen } from '@testing-library/react';

import SetupRequirement from './SetupRequirement';
import { stackOptions } from './options';

it('shows the deployment prerequisite separately when the V1 demo is selected', () => {
  render(
    <SetupRequirement requirement={stackOptions.find(({ id }) => id === 'v1')?.setupRequirement} />
  );
  expect(screen.getByRole('note').textContent).toContain('Setup requirement:');
  expect(screen.getByRole('note').textContent).toContain('v1-demo-secrets');
});

it('does not show a prerequisite for a workspace with no extra setup requirement', () => {
  render(<SetupRequirement />);
  expect(screen.queryByRole('note')).toBeNull();
});

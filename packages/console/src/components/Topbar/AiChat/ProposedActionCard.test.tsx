import { render, screen } from '@testing-library/react';

import ProposedActionCard from './ProposedActionCard';

jest.mock('@/consts/env', () => ({ isDevFeaturesEnabled: true }));

it('expired non-landing reviews never offer a confirm button', () => {
  render(
    <ProposedActionCard
      action={{
        id: 'expired',
        tool: 'create_application',
        body: {},
        expiresAt: '2020-01-01T00:00:00.000Z',
        status: 'pending',
      }}
      onConfirm={jest.fn()}
      onCancel={jest.fn()}
    />
  );
  expect(
    screen.queryByRole('button', { name: 'admin_console.inkeep_ai_bot.action_confirm' })
  ).toBeNull();
  expect(screen.getByText('Review expired')).toBeTruthy();
});

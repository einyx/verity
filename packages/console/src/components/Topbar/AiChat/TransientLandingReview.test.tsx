import { defaultLandingPageContent } from '@logto/schemas';
import { fireEvent, render, screen } from '@testing-library/react';

import TransientLandingReview from './TransientLandingReview';

jest.mock('./ReadOnlyLandingPreview', () => ({ __esModule: true, default: () => <div>Safe preview</div> }));

it('offers discard but no Save, Publish or refresh-to-Save action', () => {
  const discard = jest.fn();
  render(<TransientLandingReview preview={{ draft: defaultLandingPageContent, expiresAt: new Date(Date.now() + 60_000).toISOString() }} onDiscard={discard} />);
  expect(screen.getByText('Safe preview')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /save|publish|refresh/i })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Discard preview' }));
  expect(discard).toHaveBeenCalledTimes(1);
});

it('does not render an expired private document', () => {
  render(<TransientLandingReview preview={{ draft: defaultLandingPageContent, expiresAt: new Date(0).toISOString() }} onDiscard={jest.fn()} />);
  expect(screen.queryByText('Safe preview')).not.toBeInTheDocument();
});

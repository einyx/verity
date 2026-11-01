import resources from '@logto/phrases';
import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { createContext, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

import SsoCreationModal from '.';

jest.mock('@/consts/env', () => ({ isCloud: true }));
jest.mock('@/utils/subscription', () => ({ isPaidPlan: () => false }));
jest.mock('@/scss/modal.module.scss', () => ({ content: 'modal', overlay: 'modal-overlay' }));
jest.mock('@/utils/form', () => ({ trySubmitSafe: <T,>(handler: T) => handler }));
jest.mock('@/hooks/use-theme', () => ({ __esModule: true, default: () => 'light' }));
jest.mock('swr', () => ({ __esModule: true, default: () => ({ data: [] }) }));
jest.mock('@/hooks/use-api', () => ({ __esModule: true, default: () => ({ post: jest.fn() }) }));
jest.mock('@/hooks/use-user-preferences', () => ({
  __esModule: true,
  default: () => ({ data: { enterpriseSsoUpsellNoticeAcknowledged: true }, update: jest.fn() }),
}));
jest.mock('@/contexts/SubscriptionDataProvider', () => ({
  SubscriptionDataContext: createContext({
    currentSubscription: { planId: 'free', isEnterprisePlan: false },
    currentSubscriptionQuota: { enterpriseSsoLimit: 0 },
  }),
}));
jest.mock('react-modal', () => ({
  __esModule: true,
  default: ({ children }: { readonly children: ReactNode }) => <div>{children}</div>,
}));

beforeAll(() => {
  i18next.addResourceBundle('en', 'translation', resources.en.translation, true, true);
});

it('directs the Enterprise SSO creation contact link to MeshX', () => {
  render(
    <MemoryRouter>
      <SsoCreationModal isOpen onClose={jest.fn()} />
    </MemoryRouter>
  );
  expect(screen.getByRole('link', { name: /contact us/i }).getAttribute('href')).toBe(
    'https://meshx.io'
  );
});

import { render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';

import SigningKeysFormCard from './SigningKeysFormCard';

jest.mock('@/consts/env', () => ({ isDevFeaturesEnabled: false }));
jest.mock('swr', () => ({ __esModule: true, default: () => ({ data: [], mutate: jest.fn() }) }));
jest.mock('@/hooks/use-api', () => ({ __esModule: true, default: () => ({}) }));
jest.mock('@/hooks/use-current-tenant-scopes', () => ({
  __esModule: true,
  default: () => ({ access: { isReadOnly: false } }),
}));
jest.mock('@/hooks/use-documentation-url', () => ({
  __esModule: true,
  default: () => ({ getDocumentationUrl: () => 'https://docs.example.test' }),
}));
jest.mock('@/components/FormCard', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/ds-components/DeleteConfirmModal', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/ds-components/Select', () => ({
  __esModule: true,
  default: ({ options }: { options: Array<{ value: string }> }) => (
    <select aria-label="signing algorithm">
      {options.map(({ value }) => (
        <option key={value}>{value}</option>
      ))}
    </select>
  ),
}));
jest.mock('@/ds-components/Table', () => ({ __esModule: true, default: () => null }));
jest.mock('@/ds-components/FormField', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/ds-components/TabNav', () => ({
  __esModule: true,
  default: () => null,
  TabNavItem: () => null,
}));

it('offers ML-DSA-65 as an explicit signing algorithm with dev features disabled', () => {
  render(<SigningKeysFormCard />);
  expect(screen.getByRole('option', { name: 'ML-DSA-65' })).not.toBeNull();
});

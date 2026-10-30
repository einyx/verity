import resources from '@logto/phrases';
import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import type * as React from 'react';
import { MemoryRouter } from 'react-router-dom';

import { type EnvTestUtils } from '@/test-utils/env';

import TenantRegion from '.';

jest.mock('@/consts/env', () => jest.requireActual<EnvTestUtils>('@/test-utils/env').mockEnvModule);

jest.mock('@/contexts/TenantsProvider', () => {
  const { createContext } = jest.requireActual<typeof React>('react');

  return { TenantsContext: createContext({ currentTenant: { regionName: 'local' } }) };
});

describe('TenantRegion', () => {
  beforeAll(() => {
    i18next.addResourceBundle('en', 'translation', resources.en.translation, true, true);
  });

  it('sends the data region tip to the MeshX docs', () => {
    render(
      <MemoryRouter>
        <TenantRegion />
      </MemoryRouter>
    );

    const link = screen.getByRole('link', { name: 'Learn more' });

    expect(link.getAttribute('href')).toBe('https://docs.meshx.io/logto-cloud/tenant-settings');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener');
    expect(link.parentElement?.textContent).toContain('Your tenant resources are hosted in local.');
  });
});

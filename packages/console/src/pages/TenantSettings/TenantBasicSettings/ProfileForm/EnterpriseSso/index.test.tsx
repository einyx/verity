import resources from '@logto/phrases';
import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { MemoryRouter } from 'react-router-dom';

import { type EnvTestUtils } from '@/test-utils/env';

import EnterpriseSso from '.';

jest.mock('@/consts/env', () => jest.requireActual<EnvTestUtils>('@/test-utils/env').mockEnvModule);

beforeAll(() => {
  i18next.addResourceBundle('en', 'translation', resources.en.translation, true, true);
});

it('directs Enterprise SSO contact requests to MeshX', () => {
  render(
    <MemoryRouter>
      <EnterpriseSso />
    </MemoryRouter>
  );
  expect(screen.getByRole('link', { name: 'Contact us' }).getAttribute('href')).toBe(
    'https://meshx.io'
  );
});

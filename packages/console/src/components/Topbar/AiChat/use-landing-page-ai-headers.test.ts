import { renderHook } from '@testing-library/react';

import useLandingPageAiHeaders from './use-landing-page-ai-headers';

const getAccessToken = jest.fn();
jest.mock('@logto/react', () => ({ useLogto: () => ({ getAccessToken }) }));
jest.mock('@/consts/env', () => ({ isCloud: true }));
jest.mock('@/consts/resources', () => ({ cloudApi: { indicator: 'cloud-resource' } }));

beforeEach(() => {
  getAccessToken.mockReset();
});

it('requests a Cloud token separately from tenant Management API authentication', async () => {
  getAccessToken.mockResolvedValue('cloud-token');
  const { result } = renderHook(useLandingPageAiHeaders);
  await expect(result.current()).resolves.toEqual({
    'x-landing-page-authorization': 'Bearer cloud-token',
  });
  expect(getAccessToken).toHaveBeenCalledWith('cloud-resource');
});

it.each([undefined, ''])('does not send an empty token: %s', async (token) => {
  getAccessToken.mockResolvedValue(token);
  const { result } = renderHook(useLandingPageAiHeaders);
  await expect(result.current()).resolves.toEqual({});
});

it('keeps ordinary chat usable when the Cloud token is unavailable', async () => {
  getAccessToken.mockRejectedValue(new Error('not available'));
  const { result } = renderHook(useLandingPageAiHeaders);
  await expect(result.current()).resolves.toEqual({});
});

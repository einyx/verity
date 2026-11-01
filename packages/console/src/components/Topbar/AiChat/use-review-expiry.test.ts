import { act, renderHook } from '@testing-library/react';

import useReviewExpiry from './use-review-expiry';

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-01T12:00:00Z'));
});
afterEach(() => {
  jest.useRealTimers();
});

it('expires while mounted and resets the clock for a replacement review', () => {
  const { result, rerender, unmount } = renderHook(({ expiry }) => useReviewExpiry(expiry), {
    initialProps: { expiry: '2026-11-01T12:01:00Z' },
  });
  expect(result.current).toBe(false);
  act(() => {
    jest.advanceTimersByTime(60_000);
  });
  expect(result.current).toBe(true);
  rerender({ expiry: '2026-11-01T12:03:00Z' });
  expect(result.current).toBe(false);
  expect(jest.getTimerCount()).toBe(1);
  unmount();
  expect(jest.getTimerCount()).toBe(0);
});

it('treats invalid timestamps as expired without scheduling a timer', () => {
  const { result } = renderHook(() => useReviewExpiry('invalid'));
  expect(result.current).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});

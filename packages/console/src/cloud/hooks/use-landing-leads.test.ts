import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { SWRConfig } from 'swr';

import {
  buildLeadsQuery,
  useLandingLeads,
  useLandingLeadStats,
  type LandingLeadQuery,
  type LeadStats,
} from './use-landing-leads';

const mockGetAccessToken = jest.fn();
const mockUseLogto = jest.fn();
jest.mock('@logto/react', () => ({ useLogto: () => mockUseLogto() }));
jest.mock('@/consts', () => ({ cloudApi: { indicator: 'https://cloud.example/api' } }));

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    SWRConfig,
    { value: { provider: () => new Map(), shouldRetryOnError: false } },
    children
  );

const stats: LeadStats = {
  total: 3,
  byStage: [{ stage: 'qualified', count: 3, last7Days: 2, previous7Days: 1 }],
  byWeek: [{ weekStart: '2026-10-12', count: 3 }],
};
const mockFetch = jest.fn();
const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

beforeAll(() => {
  // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- jsdom may lack fetch; install a test-only mock and restore its descriptor after the suite.
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: mockFetch });
});

afterAll(() => {
  if (originalFetch) {
    // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- Restore the exact global descriptor saved before this suite's fetch mock.
    Object.defineProperty(globalThis, 'fetch', originalFetch);
  } else {
    Reflect.deleteProperty(globalThis, 'fetch');
  }
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUseLogto.mockReturnValue({ isAuthenticated: true, getAccessToken: mockGetAccessToken });
  mockGetAccessToken.mockResolvedValue('admin-token');
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ leads: [], totalCount: 42 }) });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('buildLeadsQuery', () => {
  it('omits empty filters and keeps a fixed parameter order', () => {
    expect(buildLeadsQuery({ search: '', stage: '', tagSearch: '', page: 1, pageSize: 20 })).toBe(
      '/api/landing-leads?limit=20&offset=0'
    );
  });

  it('encodes filters, preserving exact tag separately from substring tagSearch', () => {
    expect(
      buildLeadsQuery({
        search: 'acme corp&',
        stage: 'in progress',
        tag: 'Exact Tag',
        tagSearch: 'Priority/+?',
        page: 3,
        pageSize: 20,
      })
    ).toBe(
      '/api/landing-leads?search=acme%20corp%26&stage=in%20progress&tag=Exact%20Tag&tagSearch=Priority%2F%2B%3F&limit=20&offset=40'
    );
  });

  it.each([0, -2, Number.NaN, Number.POSITIVE_INFINITY])(
    'defaults invalid page %s to 1',
    (page) => {
      expect(buildLeadsQuery({ page, pageSize: 50 })).toBe('/api/landing-leads?limit=50&offset=0');
    }
  );

  it('floors fractional pages and sizes', () => {
    expect(buildLeadsQuery({ page: 3.9, pageSize: 20.9 })).toBe(
      '/api/landing-leads?limit=20&offset=40'
    );
  });

  it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'defaults invalid size %s to 20',
    (pageSize) => {
      expect(buildLeadsQuery({ page: 2, pageSize })).toBe('/api/landing-leads?limit=20&offset=20');
    }
  );

  it('bounds page size and offset to API-legal safe integers', () => {
    const params = new URL(
      buildLeadsQuery({ page: Number.MAX_VALUE, pageSize: 500 }),
      'https://example.com'
    ).searchParams;
    expect(params.get('limit')).toBe('100');
    expect(Number(params.get('offset'))).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
    expect(Number.isSafeInteger(Number(params.get('offset')))).toBe(true);
  });
});

describe('useLandingLeads', () => {
  it('fetches the exact keyed query once, with bearer auth and a single base prefix', async () => {
    const query: LandingLeadQuery = {
      search: 'acme corp',
      tagSearch: 'prio',
      page: 3,
      pageSize: 20,
    };
    const { result } = renderHook(() => useLandingLeads(query), { wrapper });
    await waitFor(() => {
      expect(result.current.totalCount).toBe(42);
    });
    expect(result.current.key).toBe(buildLeadsQuery(query));
    expect(mockFetch).toHaveBeenCalledWith(`${window.location.origin}${result.current.key}`, {
      headers: { Authorization: 'Bearer admin-token' },
    });
    expect(mockGetAccessToken).toHaveBeenCalledWith('https://cloud.example/api');
    await act(async () => {
      await result.current.mutate();
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('preserves the legacy 50-item page for no-argument callers and nullable booking URL handling', async () => {
    const { result } = renderHook(() => useLandingLeads(), { wrapper });
    await waitFor(() => {
      expect(result.current.leads).toEqual([]);
    });
    expect(result.current.key).toBe('/api/landing-leads?limit=50&offset=0');
    expect(result.current.bookingUrl).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('requests a fresh query when filters or page change', async () => {
    const { result, rerender } = renderHook(({ page }) => useLandingLeads({ page, pageSize: 20 }), {
      wrapper,
      initialProps: { page: 1 },
    });
    await waitFor(() => {
      expect(result.current.totalCount).toBe(42);
    });
    rerender({ page: 2 });
    await waitFor(() => {
      expect(mockFetch).toHaveBeenLastCalledWith(
        `${window.location.origin}/api/landing-leads?limit=20&offset=20`,
        { headers: { Authorization: 'Bearer admin-token' } }
      );
    });
  });

  it('requires a new successful response on a cached-key revisit inside the default dedupe window', async () => {
    const release = jest.fn<void, never[]>();
    const pending = new Promise<void>((resolve) => {
      release.mockImplementation(resolve);
    });
    const pageTwo = jest
      .fn()
      .mockResolvedValueOnce({ leads: [], totalCount: 20 })
      .mockImplementation(async () => {
        await pending;
        return { leads: [], totalCount: 21 };
      });
    mockFetch.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => (url.endsWith('offset=20') ? pageTwo() : { leads: [], totalCount: 42 }),
    }));
    const { result, rerender } = renderHook(({ page }) => useLandingLeads({ page, pageSize: 20 }), {
      wrapper,
      initialProps: { page: 2 },
    });
    expect(result.current.hasFreshResponse).toBe(false);
    await waitFor(() => {
      expect(result.current.hasFreshResponse).toBe(true);
    });
    expect(result.current.totalCount).toBe(20);
    rerender({ page: 1 });
    await waitFor(() => {
      expect(result.current.hasFreshResponse).toBe(true);
    });
    rerender({ page: 2 });
    expect(result.current.totalCount).toBe(20);
    expect(result.current.hasFreshResponse).toBe(false);
    await waitFor(() => {
      expect(pageTwo).toHaveBeenCalledTimes(2);
    });
    expect(result.current.hasFreshResponse).toBe(false);
    await act(async () => {
      release();
    });
    await waitFor(() => {
      expect(result.current.hasFreshResponse).toBe(true);
    });
    expect(result.current.totalCount).toBe(21);
  });

  it('does not authorize cached totals after the current visit refresh fails', async () => {
    const pageTwo = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ leads: [], totalCount: 20 }) })
      .mockResolvedValue({ ok: false, status: 503 });
    mockFetch.mockImplementation(async (url: string) =>
      url.endsWith('offset=20')
        ? pageTwo()
        : { ok: true, json: async () => ({ leads: [], totalCount: 42 }) }
    );
    const { result, rerender } = renderHook(({ page }) => useLandingLeads({ page, pageSize: 20 }), {
      wrapper,
      initialProps: { page: 2 },
    });
    await waitFor(() => {
      expect(result.current.hasFreshResponse).toBe(true);
    });
    rerender({ page: 1 });
    await waitFor(() => {
      expect(result.current.hasFreshResponse).toBe(true);
    });
    rerender({ page: 2 });
    expect(result.current.hasFreshResponse).toBe(false);
    await waitFor(() => {
      expect(result.current.error?.message).toBe('Leads request failed: 503');
    });
    expect(result.current.totalCount).toBe(20);
    expect(result.current.hasFreshResponse).toBe(false);
  });
});

describe('useLandingLeadStats', () => {
  it('fetches the stats path with the same token and tolerates extra fields at every level', async () => {
    const response = {
      ...stats,
      extra: true,
      byStage: stats.byStage.map((bucket) => ({ ...bucket, extra: true })),
      byWeek: stats.byWeek.map((bucket) => ({ ...bucket, extra: true })),
    };
    mockFetch.mockResolvedValue({ ok: true, json: async () => response });
    const { result } = renderHook(() => useLandingLeadStats(), { wrapper });
    await waitFor(() => {
      expect(result.current.data).toEqual(response);
    });
    expect(mockFetch).toHaveBeenCalledWith(`${window.location.origin}/api/landing-leads/stats`, {
      headers: { Authorization: 'Bearer admin-token' },
    });
    expect(mockGetAccessToken).toHaveBeenCalledWith('https://cloud.example/api');
    expect(result.current.key).toBe('/api/landing-leads/stats');
    await act(async () => {
      await result.current.mutate();
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    { ...stats, total: -1 },
    { ...stats, total: '3' },
    { ...stats, total: 1.5 },
    { ...stats, byStage: undefined },
    { ...stats, byWeek: undefined },
    { ...stats, byStage: [{ ...stats.byStage[0], stage: 1 }] },
    ...['count', 'last7Days', 'previous7Days'].map((field) => ({
      ...stats,
      byStage: [{ ...stats.byStage[0], [field]: -1 }],
    })),
    { ...stats, byWeek: [{ weekStart: 42, count: 0 }] },
    { ...stats, byWeek: [{ weekStart: '2026-10-12', count: -1 }] },
  ])('rejects malformed stats %#', async (response) => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => response });
    const { result } = renderHook(() => useLandingLeadStats(), { wrapper });
    await waitFor(() => {
      expect(result.current.error).toBeDefined();
    });
    expect(result.current.data).toBeUndefined();
  });

  it('accepts zero counts and empty buckets', async () => {
    const response = { total: 0, byStage: [], byWeek: [] };
    mockFetch.mockResolvedValue({ ok: true, json: async () => response });
    const { result } = renderHook(() => useLandingLeadStats(), { wrapper });
    await waitFor(() => {
      expect(result.current.data).toEqual(response);
    });
  });

  it('surfaces HTTP failures', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403 });
    const { result } = renderHook(() => useLandingLeadStats(), { wrapper });
    await waitFor(() => {
      expect(result.current.error?.message).toBe('Leads request failed: 403');
    });
  });
});

it('does not fetch lists or stats before authentication', async () => {
  mockUseLogto.mockReturnValue({ isAuthenticated: false, getAccessToken: mockGetAccessToken });
  const { result } = renderHook(
    () => ({ leads: useLandingLeads(), stats: useLandingLeadStats() }),
    { wrapper }
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(result.current.leads.isLoading).toBe(false);
  expect(result.current.stats.isLoading).toBe(false);
  expect(mockGetAccessToken).not.toHaveBeenCalled();
  expect(mockFetch).not.toHaveBeenCalled();
});

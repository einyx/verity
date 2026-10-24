import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SWRConfig, useSWRConfig } from 'swr';

import { type LandingLead } from '@/cloud/hooks/use-landing-leads';

import Leads from './index';

const mockGetAccessToken = jest.fn(async () => 'admin-token');
jest.mock('@logto/react', () => ({
  useLogto: () => ({ isAuthenticated: true, getAccessToken: mockGetAccessToken }),
}));
const mockEnsureScope = jest.fn(async () => true);
jest.mock('@/cloud/hooks/use-manage-landing-page-guard', () => ({
  __esModule: true,
  default: () => mockEnsureScope,
}));
jest.mock('@/hooks/use-api', () => ({ __esModule: true, default: () => ({ post: jest.fn() }) }));
jest.mock('@/hooks/use-tenant-pathname', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/consts/env', () => ({ isCloud: false, isDevFeaturesEnabled: true }));
jest.mock('@/components/FeatureTag', () => ({ CombinedAddOnAndFeatureTag: () => null }));
jest.mock('@/hooks/use-theme', () => ({ __esModule: true, default: () => 'light' }));
jest.mock('@/scss/modal.module.scss', () => ({}));
jest.mock('recharts', () => ({
  ResponsiveContainer: () => null,
  AreaChart: () => null,
  Area: () => null,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
}));

const lead: LandingLead = {
  id: 'ada',
  sessionId: 'ada-session',
  lead: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', company: 'Analytical' },
  status: 'qualified',
  emailStatus: 'sent',
  notes: 'Original notes',
  tags: ['Priority'],
  createdAt: '2026-10-20T10:00:00Z',
};
const mockFetch = jest.fn();
const mockListing = jest.fn();
const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

beforeAll(() => {
  // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- jsdom may lack fetch; install a suite-local mock and restore the original descriptor below.
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: mockFetch });
});

afterAll(() => {
  if (originalFetch) {
    // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- Restore the exact global descriptor saved before installing this suite's fetch mock.
    Object.defineProperty(globalThis, 'fetch', originalFetch);
  } else {
    Reflect.deleteProperty(globalThis, 'fetch');
  }
});

beforeEach(() => {
  jest.clearAllMocks();
  mockListing.mockReset();
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      return { ok: true, json: async () => ({}) };
    }
    if (url.endsWith('/ada-session/transcript')) {
      return { ok: true, json: async () => ({ messages: [] }) };
    }
    if (url.endsWith('/stats')) {
      return { ok: true, json: async () => ({ total: 1, byStage: [], byWeek: [] }) };
    }
    return { ok: true, json: mockListing };
  });
});

it.each(['stage', 'notes and tags'])(
  'revalidates the displayed keyed list after saving %s',
  async (action) => {
    const updated = { ...lead, status: 'contacted', notes: 'Follow up Friday', tags: ['Security'] };
    mockListing
      .mockResolvedValueOnce({ leads: [lead], totalCount: 1 })
      .mockResolvedValue({ leads: [updated], totalCount: 1 });

    render(
      <SWRConfig
        value={{ provider: () => new Map(), fetcher: async () => [], shouldRetryOnError: false }}
      >
        <Leads />
      </SWRConfig>
    );
    const queue = within(await screen.findByRole('region', { name: 'Sales queue' }));
    fireEvent.click(await queue.findByRole('button', { name: /Ada Lovelace/ }));
    await screen.findByText('This conversation has no messages.');

    if (action === 'stage') {
      fireEvent.change(screen.getByLabelText('Pipeline status'), {
        target: { value: 'contacted' },
      });
    } else {
      fireEvent.change(screen.getByLabelText('Sales notes'), {
        target: { value: 'Follow up Friday' },
      });
      fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'Security' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save notes and tags' }));
    }

    await waitFor(() => {
      expect(mockListing).toHaveBeenCalledTimes(2);
    });
    expect(mockFetch).toHaveBeenCalledWith(`${window.location.origin}/api/landing-leads/ada`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer admin-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(
        action === 'stage'
          ? { status: 'contacted' }
          : { notes: 'Follow up Friday', tags: ['Security'] }
      ),
    });
    expect(mockFetch).toHaveBeenCalledWith(
      `${window.location.origin}/api/landing-leads?limit=20&offset=0`,
      { headers: { Authorization: 'Bearer admin-token' } }
    );
    expect(await queue.findByText('Tags: Security')).toBeTruthy();
    expect(queue.getByText('contacted')).toBeTruthy();
    expect(mockFetch.mock.calls.filter(([url]) => String(url).endsWith('/stats'))).toHaveLength(2);
  }
);

it('filters and paginates at the HTTP boundary while retaining the selected workspace', async () => {
  const records = Array.from({ length: 23 }, (_, index) => ({
    ...lead,
    id: `lead-${index}`,
    sessionId: `session-${index}`,
    lead: { ...lead.lead, firstName: `Visitor ${index}` },
    notes: index === 22 ? 'Unique security note' : 'Other note',
    tags: index === 22 ? ['Partner'] : ['Priority'],
    status: index === 22 ? 'new' : 'qualified',
  }));
  mockFetch.mockImplementation(async (url: string) => {
    if (url.endsWith('/stats')) {
      return { ok: true, json: async () => ({ total: 23, byStage: [], byWeek: [] }) };
    }
    if (url.endsWith('/transcript')) {
      return { ok: true, json: async () => ({ messages: [] }) };
    }
    const { searchParams } = new URL(url);
    const matches = records.filter((record) => {
      const search = searchParams.get('search')?.toLowerCase() ?? '';
      const tag = searchParams.get('tagSearch')?.toLowerCase() ?? '';
      const stage = searchParams.get('stage');
      return (
        `${record.lead.firstName} ${record.lead.lastName} ${record.lead.email} ${record.lead.company} ${record.notes}`
          .toLowerCase()
          .includes(search) &&
        record.tags.some((value) => value.toLowerCase().includes(tag)) &&
        (!stage || record.status === stage)
      );
    });
    const offset = Number(searchParams.get('offset'));
    const limit = Number(searchParams.get('limit'));
    return {
      ok: true,
      json: async () => ({
        leads: matches.slice(offset, offset + limit),
        totalCount: matches.length,
      }),
    };
  });
  render(
    <SWRConfig
      value={{ provider: () => new Map(), fetcher: async () => [], shouldRetryOnError: false }}
    >
      <Leads />
    </SWRConfig>
  );
  const queue = within(await screen.findByRole('region', { name: 'Sales queue' }));
  fireEvent.click(await queue.findByRole('button', { name: /Visitor 0 Lovelace/ }));
  fireEvent.change(screen.getByLabelText('Sales notes'), { target: { value: 'Keep this draft' } });
  fireEvent.click(queue.getByRole('button', { name: '2' }));
  expect(await queue.findByRole('button', { name: /Visitor 22 Lovelace/ })).toBeTruthy();
  expect(screen.getByLabelText('Sales notes')).toHaveProperty('value', 'Keep this draft');
  fireEvent.change(queue.getByLabelText('Search leads'), { target: { value: 'SECURITY' } });
  expect(await queue.findByText('1 matching')).toBeTruthy();
  expect(queue.getByRole('button', { name: /Visitor 22 Lovelace/ })).toBeTruthy();
  expect(mockFetch).toHaveBeenCalledWith(
    `${window.location.origin}/api/landing-leads?search=SECURITY&limit=20&offset=0`,
    expect.anything()
  );
  fireEvent.change(queue.getByLabelText('Filter by tag'), { target: { value: 'ART' } });
  fireEvent.change(queue.getByLabelText('Filter by pipeline status'), { target: { value: 'new' } });
  await waitFor(() => {
    expect(mockFetch).toHaveBeenCalledWith(
      `${window.location.origin}/api/landing-leads?search=SECURITY&stage=new&tagSearch=ART&limit=20&offset=0`,
      expect.anything()
    );
  });
  expect(await queue.findByText('1 matching')).toBeTruthy();
  fireEvent.change(queue.getByLabelText('Filter by tag'), { target: { value: 'no-match' } });
  expect(await queue.findByText('No leads match your filters.')).toBeTruthy();
  expect(queue.getByText('0 matching')).toBeTruthy();
  fireEvent.change(queue.getByLabelText('Search leads'), { target: { value: '' } });
  fireEvent.change(queue.getByLabelText('Filter by tag'), { target: { value: '' } });
  fireEvent.change(queue.getByLabelText('Filter by pipeline status'), { target: { value: '' } });
  expect(await queue.findByText('23 matching')).toBeTruthy();
  const selected = await queue.findByRole('button', { name: /Visitor 0 Lovelace/ });
  expect(selected.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByLabelText('Sales notes')).toHaveProperty('value', 'Keep this draft');
});

function RefreshFixtureList() {
  const { mutate } = useSWRConfig();
  return (
    <button
      type="button"
      onClick={async () => {
        await mutate('/api/landing-leads?stage=qualified&limit=20&offset=0');
      }}
    >
      Refresh fixture list
    </button>
  );
}

it.each([false, true])(
  'clamps shrinking results and revisits a regrown cached page without bouncing (regrow: %s)',
  async (shouldRegrow) => {
    const records = new Map(
      Array.from({ length: 21 }, (_, index) => [
        `lead-${index}`,
        {
          ...lead,
          id: `lead-${index}`,
          sessionId: `session-${index}`,
          lead: { ...lead.lead, firstName: `Visitor ${index}` },
        },
      ])
    );
    const releasePageTwo = jest.fn<void, never[]>();
    const loadingPageTwo = new Promise<void>((resolve) => {
      releasePageTwo.mockImplementation(resolve);
    });
    const waitForPageTwo = jest.fn(async () => loadingPageTwo);
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        const id = url.split('/').at(-1)!;
        const record = records.get(id)!;
        const fields = JSON.parse(String(init.body)) as Partial<LandingLead>;
        records.set(id, { ...record, ...fields });
        return { ok: true, json: async () => ({}) };
      }
      if (url.endsWith('/stats')) {
        return { ok: true, json: async () => ({ total: 21, byStage: [], byWeek: [] }) };
      }
      if (url.endsWith('/transcript')) {
        return { ok: true, json: async () => ({ messages: [] }) };
      }
      const { searchParams } = new URL(url);
      const offset = Number(searchParams.get('offset'));
      if (offset === 20) {
        await waitForPageTwo();
      }
      const matches = [...records.values()].filter(
        (record) => !searchParams.get('stage') || record.status === searchParams.get('stage')
      );
      return {
        ok: true,
        json: async () => ({
          leads: matches.slice(offset, offset + 20),
          totalCount: matches.length,
        }),
      };
    });
    render(
      <SWRConfig
        value={{ provider: () => new Map(), fetcher: async () => [], shouldRetryOnError: false }}
      >
        <Leads />
        {shouldRegrow && <RefreshFixtureList />}
      </SWRConfig>
    );
    const queue = within(await screen.findByRole('region', { name: 'Sales queue' }));
    await queue.findByText('21 matching');
    fireEvent.change(queue.getByLabelText('Filter by pipeline status'), {
      target: { value: 'qualified' },
    });
    await queue.findByText('21 matching');
    fireEvent.click(queue.getByRole('button', { name: '2' }));
    await waitFor(() => {
      expect(waitForPageTwo.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
    expect(queue.getByText('Loading leads…')).toBeTruthy();
    const listCallsBeforeResolution = mockFetch.mock.calls
      .filter(([url]) => String(url).includes('landing-leads?'))
      .map(([url]) => String(url));
    expect(listCallsBeforeResolution.at(-1)).toContain('stage=qualified&limit=20&offset=20');
    await act(async () => {
      releasePageTwo();
    });
    fireEvent.click(await queue.findByRole('button', { name: /Visitor 20 Lovelace/ }));
    fireEvent.change(screen.getByLabelText('Sales notes'), {
      target: { value: 'Retain this selected draft' },
    });
    fireEvent.change(screen.getByLabelText('Pipeline status'), { target: { value: 'contacted' } });
    expect(await queue.findByText('20 matching')).toBeTruthy();
    expect(await queue.findByRole('button', { name: /Visitor 0 Lovelace/ })).toBeTruthy();
    expect(queue.getAllByRole('button', { name: /Visitor/ })).toHaveLength(20);
    expect(queue.queryByText('No leads match your filters.')).toBeNull();
    await waitFor(() => {
      expect(queue.queryByRole('button', { name: '2' })).toBeNull();
    });
    expect(screen.getByLabelText('Sales notes')).toHaveProperty(
      'value',
      'Retain this selected draft'
    );
    expect(screen.getByLabelText('Pipeline status')).toHaveProperty('value', 'contacted');
    const settledListCalls = mockFetch.mock.calls
      .filter(([url]) => String(url).includes('landing-leads?'))
      .map(([url]) => String(url));
    expect(settledListCalls.at(-1)).toContain('stage=qualified&limit=20&offset=0');

    if (!shouldRegrow) {
      return;
    }
    const releaseRevisit = jest.fn<void, never[]>();
    const revisitResponse = new Promise<void>((resolve) => {
      releaseRevisit.mockImplementation(resolve);
    });
    waitForPageTwo.mockImplementation(async () => revisitResponse);
    records.set('lead-21', {
      ...lead,
      id: 'lead-21',
      sessionId: 'session-21',
      lead: { ...lead.lead, firstName: 'Visitor 21' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh fixture list' }));
    });
    await queue.findByText('21 matching');
    fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'Retain local tags' } });
    const pageTwoRequests = waitForPageTwo.mock.calls.length;
    const pageOneRequests = mockFetch.mock.calls.filter(([url]) =>
      String(url).includes('stage=qualified&limit=20&offset=0')
    ).length;
    fireEvent.click(await queue.findByRole('button', { name: '2' }));
    await waitFor(() => {
      expect(waitForPageTwo).toHaveBeenCalledTimes(pageTwoRequests + 1);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      mockFetch.mock.calls.filter(([url]) =>
        String(url).includes('stage=qualified&limit=20&offset=0')
      )
    ).toHaveLength(pageOneRequests);
    expect(queue.getByText('Loading leads…')).toBeTruthy();
    expect(queue.getByRole('button', { name: '2' }).className).toContain('active');
    expect(screen.getByRole('heading', { name: 'Visitor 20 Lovelace' })).toBeTruthy();
    expect(screen.getByLabelText('Sales notes')).toHaveProperty(
      'value',
      'Retain this selected draft'
    );
    expect(screen.getByLabelText('Tags')).toHaveProperty('value', 'Retain local tags');
    await act(async () => {
      releaseRevisit();
    });
    expect(await queue.findByRole('button', { name: /Visitor 21 Lovelace/ })).toBeTruthy();
    expect(queue.getByText('21 matching')).toBeTruthy();
    expect(queue.queryByRole('button', { name: /Visitor 0 Lovelace/ })).toBeNull();
    expect(queue.getByRole('button', { name: '2' }).className).toContain('active');
    expect(screen.getByLabelText('Sales notes')).toHaveProperty(
      'value',
      'Retain this selected draft'
    );
    expect(screen.getByLabelText('Tags')).toHaveProperty('value', 'Retain local tags');
  }
);

/* eslint-disable max-lines -- Preserve the original page regressions alongside assembly and async-lifetime coverage. */
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import {
  type LandingLead,
  buildLeadsQuery,
  useLandingLeads,
  useLandingLeadStats,
} from '@/cloud/hooks/use-landing-leads';
import useManageLandingPageGuard from '@/cloud/hooks/use-manage-landing-page-guard';

import Leads from './index';

const mockGetDemoRequests = jest.fn(
  (): Array<{ name: string; email: string; phase: string }> => []
);
const mockApiPost = jest.fn();
const mockMutate = jest.fn();

jest.mock('@logto/react', () => ({ useLogto: jest.fn() }));
jest.mock('@/consts', () => ({ cloudApi: { indicator: 'https://cloud.example/api' } }));
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

jest.mock('@/cloud/hooks/use-landing-leads', () => ({
  ...jest.requireActual('@/cloud/hooks/use-landing-leads'),
  useLandingLeads: jest.fn(),
  useLandingLeadStats: jest.fn(),
}));
jest.mock('@/cloud/hooks/use-manage-landing-page-guard', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('@/hooks/use-api', () => ({ __esModule: true, default: () => ({ post: mockApiPost }) }));
jest.mock('@/hooks/use-tenant-pathname', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/consts/env', () => ({ isCloud: false, isDevFeaturesEnabled: true }));
jest.mock('@/components/FeatureTag', () => ({ CombinedAddOnAndFeatureTag: () => null }));
jest.mock('@/hooks/use-theme', () => ({ __esModule: true, default: () => 'light' }));
jest.mock('swr', () => ({
  __esModule: true,
  default: () => ({ data: mockGetDemoRequests(), mutate: jest.fn() }),
  useSWRConfig: () => ({ mutate: mockMutate }),
}));

const leads: LandingLead[] = [
  {
    id: 'ada',
    sessionId: 'ada-session',
    lead: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      company: 'Analytical',
    },
    status: 'qualified',
    emailStatus: 'sent',
    tags: ['Priority'],
    notes: 'Interested in security',
    createdAt: '2026-10-20T10:00:00Z',
  },
  {
    id: 'grace',
    sessionId: 'grace-session',
    lead: {
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
      company: 'Compiler',
    },
    status: 'new',
    emailStatus: 'pending',
    tags: ['Partner'],
    createdAt: '2026-10-21T10:00:00Z',
  },
];
const listing = {
  key: '/api/landing-leads?limit=20&offset=0',
  totalCount: leads.length,
  mutate: jest.fn(),
  leads,
  bookingUrl: undefined,
  error: undefined,
  isLoading: false,
  hasFreshResponse: true,
  loadTranscript: jest.fn().mockResolvedValue([{ role: 'user', content: 'Please contact me.' }]),
  loadBriefPdf: jest.fn(),
  loadSlides: jest.fn(),
  loadSlidesPptx: jest.fn(),
  updateLead: jest.fn(),
  loadAssist: jest.fn(),
};
const defaultQuery = { page: 1, pageSize: 20 };

beforeEach(() => {
  jest.clearAllMocks();
  mockGetDemoRequests.mockReset();
  mockGetDemoRequests.mockReturnValue([]);
  jest.mocked(useManageLandingPageGuard).mockReturnValue(async () => true);
  // Model the service boundary: filter before counting and slicing, just like the API.
  jest.mocked(useLandingLeads).mockImplementation((query = defaultQuery) => {
    const matches = leads.filter(
      (lead) =>
        (!query.search ||
          `${lead.lead.firstName} ${lead.lead.lastName} ${lead.lead.email} ${lead.lead.company} ${lead.notes ?? ''}`
            .toLowerCase()
            .includes(query.search.toLowerCase())) &&
        (!query.stage || lead.status === query.stage) &&
        (!query.tagSearch ||
          lead.tags?.some((tag) => tag.toLowerCase().includes(query.tagSearch!.toLowerCase())))
    );
    return {
      ...listing,
      key: buildLeadsQuery(query),
      totalCount: matches.length,
      leads: matches.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
    };
  });
  jest.mocked(useLandingLeadStats).mockReturnValue({
    key: '/api/landing-leads/stats',
    data: { total: 0, byStage: [], byWeek: [] },
    isLoading: false,
    error: undefined,
    mutate: jest.fn(),
  });
});

const renderQueue = async () => {
  render(<Leads />);
  return within(await screen.findByRole('region', { name: 'Sales queue' }));
};

const deferred = <T,>() => {
  const resolve = jest.fn<void, [T]>();
  const reject = jest.fn<void, [Error]>();
  const promise = new Promise<T>((_resolve, _reject) => {
    resolve.mockImplementation(_resolve);
    reject.mockImplementation(_reject);
  });
  return { promise, resolve, reject };
};

it('shows permission checking rather than a denial while the guard is pending', async () => {
  const scope = deferred<boolean>();
  jest.mocked(useManageLandingPageGuard).mockReturnValue(async () => scope.promise);
  render(<Leads />);
  expect(screen.queryByText(/do not have permission/)).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('Checking');
  await act(async () => {
    scope.resolve(true);
  });
  expect(await screen.findByRole('region', { name: 'Sales queue' })).toBeTruthy();
});

it('requests explicit server filters and page size, resetting each filter from page two', async () => {
  jest.mocked(useLandingLeads).mockImplementation((query = defaultQuery) => ({
    ...listing,
    key: buildLeadsQuery(query),
    totalCount: 41,
    leads: query.page === 1 ? [leads[0]!] : [leads[1]!],
  }));
  const queue = await renderQueue();
  expect(useLandingLeads).toHaveBeenLastCalledWith({
    page: 1,
    pageSize: 20,
    search: '',
    stage: '',
    tagSearch: '',
  });
  fireEvent.click(queue.getByRole('button', { name: /Ada Lovelace/ }));
  await screen.findByText('Please contact me.');
  for (const [label, value, field] of [
    ['Search leads', 'security', 'search'],
    ['Filter by pipeline status', 'qualified', 'stage'],
    ['Filter by tag', 'PRIO', 'tagSearch'],
  ]) {
    fireEvent.click(queue.getByRole('button', { name: '2' }));
    expect(useLandingLeads).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    expect(screen.getByLabelText('Sales notes')).toHaveProperty('value', 'Interested in security');
    fireEvent.change(queue.getByLabelText(label!), { target: { value } });
    expect(useLandingLeads).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, pageSize: 20, [field!]: value })
    );
  }
  expect(queue.getByText('41 matching')).toBeTruthy();
  expect(screen.getByLabelText('Sales notes')).toHaveProperty('value', 'Interested in security');
});

it.each(['loading', 'error', 'zero'])(
  'keeps the queue usable with independent stats %s',
  async (state) => {
    jest.mocked(useLandingLeadStats).mockReturnValue({
      key: '/api/landing-leads/stats',
      data: state === 'zero' ? { total: 0, byStage: [], byWeek: [] } : undefined,
      isLoading: state === 'loading',
      error: state === 'error' ? new Error('offline') : undefined,
      mutate: jest.fn(),
    });
    const queue = await renderQueue();
    expect(queue.getByRole('button', { name: /Ada Lovelace/ })).toBeTruthy();
    if (state === 'zero') {
      expect(screen.getByText('Total leads')).toBeTruthy();
      expect(screen.getByRole('region', { name: 'Pipeline' })).toBeTruthy();
      expect(screen.getAllByText('0%')).toHaveLength(7);
    } else {
      expect(screen.queryByText('Total leads')).toBeNull();
      expect(
        screen.getByText(
          state === 'loading' ? 'Loading lead statistics…' : 'Lead statistics could not be loaded.'
        )
      ).toBeTruthy();
    }
  }
);

it('shows creation KPIs across all stages and the independent weekly chart', async () => {
  jest.mocked(useLandingLeadStats).mockReturnValue({
    key: '/api/landing-leads/stats',
    data: {
      total: 9,
      byStage: [
        { stage: 'new', count: 2, last7Days: 2, previous7Days: 1 },
        { stage: 'qualified', count: 4, last7Days: 3, previous7Days: 1 },
        { stage: 'demo_requested', count: 3, last7Days: 1, previous7Days: 1 },
      ],
      byWeek: [{ weekStart: '2026-10-12', count: 8 }],
    },
    isLoading: false,
    error: undefined,
    mutate: jest.fn(),
  });
  await renderQueue();
  const creationTile = screen.getByText('New · 7 days').closest('.eyebrow');
  expect(creationTile?.textContent).toContain('6');
  expect(creationTile?.textContent).toContain('(+3)');
  expect(
    screen.getByRole('img', { name: /New leads per week over the last 1 weeks.*Peak: 8 leads/ })
  ).toBeTruthy();
});

it('retains dirty per-lead drafts and focuses the selected heading without losing pressed semantics', async () => {
  const queue = await renderQueue();
  const ada = queue.getByRole('button', { name: /Ada Lovelace/ });
  fireEvent.click(ada);
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Ada Lovelace' }));
  fireEvent.change(screen.getByLabelText('Sales notes'), { target: { value: 'Unsaved Ada' } });
  fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'Draft tag' } });
  fireEvent.click(queue.getByRole('button', { name: /Grace Hopper/ }));
  fireEvent.change(screen.getByLabelText('Sales notes'), { target: { value: 'Unsaved Grace' } });
  fireEvent.click(ada);
  expect(ada.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByLabelText('Sales notes')).toHaveProperty('value', 'Unsaved Ada');
  expect(screen.getByLabelText('Tags')).toHaveProperty('value', 'Draft tag');
  await act(async () => {
    await Promise.resolve();
  });
});

it.each([true, false])(
  'focuses selected details in the single page scroll at every viewport (desktop: %s)',
  async (isDesktop) => {
    const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- Install a viewport mock and restore its descriptor below.
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: jest.fn((query: string) => ({
        matches: query === '(min-width: 900px)' && isDesktop,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      })),
    });
    const focus = jest.spyOn(HTMLElement.prototype, 'focus');
    try {
      const queue = await renderQueue();
      fireEvent.click(queue.getByRole('button', { name: /Ada Lovelace/ }));
      const detail = screen.getByRole('region', { name: 'Selected lead details' });
      const workspace = screen.getByRole('complementary', { name: 'Lead workspace' });
      expect(detail.contains(screen.getByRole('heading', { name: 'Ada Lovelace' }))).toBe(true);
      expect(workspace.contains(detail)).toBe(true);
      expect(detail.contains(screen.getByText('Pipeline'))).toBe(false);
      const pipeline = screen.getByText('Pipeline');
      expect(
        pipeline.compareDocumentPosition(queue.getByRole('button', { name: /Ada Lovelace/ }))
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(
        queue.getByRole('button', { name: /Ada Lovelace/ }).compareDocumentPosition(detail)
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      fireEvent.click(queue.getByRole('button', { name: /Grace Hopper/ }));
      expect(focus).toHaveBeenLastCalledWith();
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Grace Hopper' }));
      fireEvent.click(queue.getByRole('button', { name: /Grace Hopper/ }));
      expect(focus).toHaveBeenLastCalledWith();
      await act(async () => {
        await Promise.resolve();
      });
    } finally {
      focus.mockRestore();
      if (originalMatchMedia) {
        // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- Restore the original browser API after the test.
        Object.defineProperty(window, 'matchMedia', originalMatchMedia);
      } else {
        Reflect.deleteProperty(window, 'matchMedia');
      }
    }
  }
);

it('updates the selected saved copy and revalidates the exact list key and stats', async () => {
  const queue = await renderQueue();
  fireEvent.click(queue.getByRole('button', { name: /Ada Lovelace/ }));
  fireEvent.change(screen.getByLabelText('Pipeline status'), { target: { value: 'contacted' } });
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByLabelText('Pipeline status')).toHaveProperty('value', 'contacted');
  expect(mockMutate).toHaveBeenCalledWith('/api/landing-leads?limit=20&offset=0');
  expect(mockMutate).toHaveBeenCalledWith('/api/landing-leads/stats');
});

it('ignores old transcript, assist, file, save and demo failures after switching leads', async () => {
  const transcript = deferred<Awaited<ReturnType<typeof listing.loadTranscript>>>();
  const assist = deferred<never>();
  const file = deferred<Blob>();
  const save = deferred<void>();
  const demo = deferred<void>();
  jest.mocked(useLandingLeads).mockReturnValue({
    ...listing,
    loadTranscript: jest.fn(async (id: string) =>
      id === 'ada-session'
        ? transcript.promise
        : Promise.resolve([{ role: 'user', content: 'Grace conversation' }])
    ),
    loadAssist: jest.fn(async () => assist.promise),
    loadBriefPdf: jest.fn(async () => file.promise),
    updateLead: jest.fn(async () => save.promise),
  });
  mockGetDemoRequests.mockReturnValue([
    { name: 'ada-demo', email: 'ada@example.com', phase: 'Pending' },
  ]);
  mockApiPost.mockReturnValue(demo.promise);
  const queue = await renderQueue();
  fireEvent.click(queue.getByRole('button', { name: /Ada Lovelace/ }));
  fireEvent.click(screen.getByRole('button', { name: 'AI lead assist' }));
  fireEvent.click(screen.getByRole('button', { name: 'Download meeting brief (PDF)' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save notes and tags' }));
  fireEvent.click(screen.getByRole('button', { name: 'Approve demo' }));
  fireEvent.click(screen.getByRole('button', { name: 'Approve demo' }));
  expect(mockApiPost).toHaveBeenCalledTimes(1);
  fireEvent.click(queue.getByRole('button', { name: /Grace Hopper/ }));
  await screen.findByText('Grace conversation');
  await act(async () => {
    transcript.resolve([{ role: 'user', content: 'Old Ada conversation' }]);
    assist.reject(new Error('old'));
    file.reject(new Error('old'));
    save.reject(new Error('old'));
    demo.reject(new Error('old'));
  });
  expect(screen.queryByText('Old Ada conversation')).toBeNull();
  expect(screen.queryByText('The conversation could not be loaded.')).toBeNull();
  expect(screen.queryByText('The file could not be created.')).toBeNull();
  expect(screen.queryByText('Lead changes could not be saved.')).toBeNull();
  expect(screen.queryByText('The decision could not be saved.')).toBeNull();
  expect(screen.queryByText(/AI assistance is unavailable/)).toBeNull();
  expect(screen.getByLabelText('Sales notes')).toHaveProperty('value', '');
});

it('ignores successful old assist and download results, and a saved old lead cannot replace the new lead', async () => {
  const assist = deferred<Awaited<ReturnType<ReturnType<typeof useLandingLeads>['loadAssist']>>>();
  const file = deferred<Blob>();
  const save = deferred<void>();
  jest.mocked(useLandingLeads).mockReturnValue({
    ...listing,
    loadAssist: jest.fn(async () => assist.promise),
    loadBriefPdf: jest.fn(async () => file.promise),
    updateLead: jest.fn(async () => save.promise),
  });
  const queue = await renderQueue();
  fireEvent.click(queue.getByRole('button', { name: /Ada Lovelace/ }));
  fireEvent.click(screen.getByRole('button', { name: 'AI lead assist' }));
  fireEvent.click(screen.getByRole('button', { name: 'Download meeting brief (PDF)' }));
  fireEvent.change(screen.getByLabelText('Sales notes'), { target: { value: 'Ada saved' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save notes and tags' }));
  fireEvent.click(queue.getByRole('button', { name: /Grace Hopper/ }));
  await screen.findByText('Please contact me.');
  const download = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(jest.fn());
  await act(async () => {
    assist.resolve({
      qualification: 'high',
      summary: 'Old Ada assist',
      rationale: [],
      suggestedNextSteps: [],
      followUpDraft: 'Old draft',
    });
    file.resolve(new Blob(['old pdf']));
    save.resolve();
  });
  expect(download).not.toHaveBeenCalled();
  expect(screen.queryByText('Old Ada assist')).toBeNull();
  expect(screen.getByLabelText('Sales notes')).toHaveProperty('value', '');
  expect(screen.getByLabelText('Pipeline status')).toHaveProperty('value', 'new');
  expect(mockMutate).toHaveBeenCalledWith('/api/landing-leads/stats');
  download.mockRestore();
});

it('keeps edits made during a pending save and prevents duplicate writes', async () => {
  const save = deferred<void>();
  const updateLead = jest.fn(async () => save.promise);
  jest.mocked(useLandingLeads).mockReturnValue({ ...listing, updateLead });
  const queue = await renderQueue();
  fireEvent.click(queue.getByRole('button', { name: /Ada Lovelace/ }));
  fireEvent.change(screen.getByLabelText('Sales notes'), { target: { value: 'First draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save notes and tags' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save notes and tags' }));
  expect(updateLead).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('Sales notes'), { target: { value: 'Newer draft' } });
  await act(async () => {
    save.resolve();
  });
  expect(screen.getByLabelText('Sales notes')).toHaveProperty('value', 'Newer draft');
  fireEvent.click(queue.getByRole('button', { name: /Grace Hopper/ }));
  fireEvent.click(queue.getByRole('button', { name: /Ada Lovelace/ }));
  expect(screen.getByLabelText('Sales notes')).toHaveProperty('value', 'Newer draft');
  await act(async () => {
    await Promise.resolve();
  });
});

it.each(['stage then notes', 'notes then stage', 'notes then changed notes'])(
  'visibly blocks conflicting saves without losing editable drafts: %s',
  async (actions) => {
    const save = deferred<void>();
    const updateLead = jest
      .fn()
      .mockResolvedValue(undefined)
      .mockImplementationOnce(async () => save.promise);
    jest.mocked(useLandingLeads).mockReturnValue({ ...listing, updateLead });
    const queue = await renderQueue();
    fireEvent.click(queue.getByRole('button', { name: /Ada Lovelace/ }));
    if (actions === 'stage then notes') {
      fireEvent.change(screen.getByLabelText('Pipeline status'), {
        target: { value: 'contacted' },
      });
    } else {
      fireEvent.change(screen.getByLabelText('Sales notes'), {
        target: { value: 'First submission' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save notes and tags' }));
    }
    const saveButton = screen.getByRole('button', { name: 'Save notes and tags' });
    expect(saveButton).toHaveProperty('disabled', true);
    expect(screen.getByLabelText('Pipeline status')).toHaveProperty('disabled', true);
    expect(screen.getByText('Saving lead changes…').getAttribute('role')).toBe('status');
    expect(screen.getByLabelText('Sales notes')).toHaveProperty('disabled', false);
    expect(screen.getByLabelText('Tags')).toHaveProperty('disabled', false);
    fireEvent.change(screen.getByLabelText('Sales notes'), {
      target: { value: 'Second submission' },
    });
    fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'Changed' } });
    fireEvent.click(saveButton);
    expect(updateLead).toHaveBeenCalledTimes(1);
    await act(async () => {
      save.resolve();
    });
    expect(screen.getByRole('button', { name: 'Save notes and tags' })).toHaveProperty(
      'disabled',
      false
    );
    expect(screen.getByLabelText('Pipeline status')).toHaveProperty('disabled', false);
    expect(screen.queryByText('Saving lead changes…')).toBeNull();
    expect(screen.getByLabelText('Sales notes')).toHaveProperty('value', 'Second submission');
    if (actions === 'notes then stage') {
      fireEvent.change(screen.getByLabelText('Pipeline status'), {
        target: { value: 'contacted' },
      });
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'Save notes and tags' }));
    }
    await act(async () => {
      await Promise.resolve();
    });
    expect(updateLead).toHaveBeenNthCalledWith(
      2,
      'ada',
      actions === 'notes then stage'
        ? { status: 'contacted' }
        : { notes: 'Second submission', tags: ['Changed'] }
    );
  }
);

it('refreshes both the starting and currently displayed list if filters change during a save', async () => {
  const save = deferred<void>();
  jest.mocked(useLandingLeads).mockImplementation((query = defaultQuery) => ({
    ...listing,
    key: buildLeadsQuery(query),
    updateLead: async () => save.promise,
  }));
  const queue = await renderQueue();
  fireEvent.click(queue.getByRole('button', { name: /Ada Lovelace/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Save notes and tags' }));
  fireEvent.change(queue.getByLabelText('Filter by tag'), { target: { value: 'Priority' } });
  await act(async () => {
    save.resolve();
  });
  expect(mockMutate).toHaveBeenCalledWith('/api/landing-leads?limit=20&offset=0');
  expect(mockMutate).toHaveBeenCalledWith(
    '/api/landing-leads?tagSearch=Priority&limit=20&offset=0'
  );
  expect(mockMutate).toHaveBeenCalledWith('/api/landing-leads/stats');
});

it('clamps fresh empty totals to page one, but ignores cached, loading and failed totals', async () => {
  jest.mocked(useLandingLeads).mockReturnValue({ ...listing, totalCount: 41 });
  const view = render(<Leads />);
  const queue = within(await screen.findByRole('region', { name: 'Sales queue' }));
  fireEvent.click(await queue.findByRole('button', { name: '3' }));
  expect(useLandingLeads).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 }));
  jest
    .mocked(useLandingLeads)
    .mockReturnValue({ ...listing, leads: undefined, totalCount: 0, isLoading: true });
  view.rerender(<Leads />);
  expect(useLandingLeads).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 }));
  jest
    .mocked(useLandingLeads)
    .mockReturnValue({ ...listing, leads: undefined, totalCount: 0, error: new Error('offline') });
  view.rerender(<Leads />);
  expect(useLandingLeads).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 }));
  jest
    .mocked(useLandingLeads)
    .mockReturnValue({ ...listing, leads: [], totalCount: 0, hasFreshResponse: false });
  view.rerender(<Leads />);
  expect(useLandingLeads).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 }));
  jest.mocked(useLandingLeads).mockReturnValue({ ...listing, leads: [], totalCount: 0 });
  view.rerender(<Leads />);
  expect(useLandingLeads).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }));
});

it('does not load leads or render queue controls without landing-page permission', async () => {
  jest.mocked(useManageLandingPageGuard).mockReturnValue(async () => false);
  await act(async () => {
    render(<Leads />);
  });
  expect(screen.getByText('You do not have permission to view landing page leads.')).toBeTruthy();
  expect(useLandingLeads).not.toHaveBeenCalled();
  expect(screen.queryByRole('region', { name: 'Sales queue' })).toBeNull();
});

it('keeps the meeting booking action absent when no booking URL is configured', async () => {
  const queue = await renderQueue();
  fireEvent.click(queue.getByRole('button', { name: /Ada Lovelace/ }));
  await screen.findByText('Please contact me.');
  expect(screen.queryByRole('button', { name: 'Book a meeting' })).toBeNull();
});

it('passes request failures through to the extracted details without losing edits', async () => {
  const fail = async () => {
    throw new Error('offline');
  };
  const updateLead = jest.fn(fail);
  jest.mocked(useLandingLeads).mockReturnValue({
    ...listing,
    loadTranscript: jest.fn(fail),
    loadAssist: jest.fn(fail),
    loadBriefPdf: jest.fn(fail),
    updateLead,
  });
  mockGetDemoRequests.mockReturnValue([
    { name: 'ada-demo', email: 'ADA@example.com', phase: 'Pending' },
  ]);
  mockApiPost.mockRejectedValueOnce(new Error('offline'));
  const queue = await renderQueue();
  fireEvent.click(queue.getByRole('button', { name: /Ada Lovelace/ }));
  expect(await screen.findByText('The conversation could not be loaded.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Sales notes'), { target: { value: 'Keep my edit' } });
  fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'one, one, two, ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save notes and tags' }));
  expect(await screen.findByText('Lead changes could not be saved.')).toBeTruthy();
  expect(listing.mutate).not.toHaveBeenCalled();
  expect(updateLead).toHaveBeenCalledWith('ada', {
    notes: 'Keep my edit',
    tags: ['one', 'two'],
  });
  fireEvent.click(screen.getByRole('button', { name: 'AI lead assist' }));
  expect(
    await screen.findByText(
      'AI assistance is unavailable. Check the AI configuration and try again.'
    )
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Download meeting brief (PDF)' }));
  expect(await screen.findByText('The file could not be created.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Approve demo' }));
  expect(await screen.findByText('The decision could not be saved.')).toBeTruthy();
  expect(screen.getByLabelText('Sales notes')).toHaveProperty('value', 'Keep my edit');
  expect(screen.getByLabelText('Tags')).toHaveProperty('value', 'one, one, two, ');
});

it('announces queue loading without showing an empty state', async () => {
  jest.mocked(useLandingLeads).mockReturnValue({ ...listing, leads: undefined, isLoading: true });
  const queue = await renderQueue();
  expect(queue.getByRole('status').textContent).toContain('Loading leads');
  expect(queue.queryByText('No leads yet.')).toBeNull();
});

it('announces a queue load error', async () => {
  jest
    .mocked(useLandingLeads)
    .mockReturnValue({ ...listing, leads: undefined, error: new Error('offline') });
  const queue = await renderQueue();
  expect(queue.getByRole('alert').textContent).toContain('Leads could not be loaded');
  expect(queue.queryByText('No leads yet.')).toBeNull();
});

it('shows an empty queue when there are no leads', async () => {
  jest.mocked(useLandingLeads).mockReturnValue({ ...listing, leads: [], totalCount: 0 });
  const queue = await renderQueue();
  expect(queue.getByRole('status').textContent).toContain('No leads yet.');
});

it('keeps cached leads selectable after a revalidation error', async () => {
  jest.mocked(useLandingLeads).mockReturnValue({ ...listing, error: new Error('offline') });
  const queue = await renderQueue();
  const ada = queue.getByRole('button', { name: /Ada Lovelace/ });
  expect(queue.queryByRole('alert')).toBeNull();
  expect(queue.getAllByRole('button')).toHaveLength(2);
  fireEvent.click(ada);
  expect(ada.getAttribute('aria-pressed')).toBe('true');
  expect(await screen.findByText('Please contact me.')).toBeTruthy();
});

it.each([undefined, leads])(
  'prioritizes loading over errors with cached data %p',
  async (cachedLeads) => {
    jest.mocked(useLandingLeads).mockReturnValue({
      ...listing,
      leads: cachedLeads,
      isLoading: true,
      error: new Error('offline'),
    });
    const queue = await renderQueue();
    expect(queue.getByRole('status').textContent).toContain('Loading leads');
    expect(queue.queryByRole('alert')).toBeNull();
    expect(queue.queryByRole('button', { name: /Ada Lovelace/ })).toBeNull();
  }
);

it('selects leads with focusable buttons and exposes lead-specific notes, tags and conversation', async () => {
  jest.mocked(useLandingLeads).mockReturnValue({
    ...listing,
    loadTranscript: jest.fn(async (sessionId: string) => [
      { role: 'user', content: `Transcript for ${sessionId}` },
    ]),
  });
  const queue = await renderQueue();
  const ada = queue.getByRole('button', { name: /Ada Lovelace/ });
  const grace = queue.getByRole('button', { name: /Grace Hopper/ });
  expect(ada.getAttribute('aria-pressed')).toBe('false');
  ada.focus();
  expect(document.activeElement).toBe(ada);
  fireEvent.click(ada);
  expect(ada.getAttribute('aria-pressed')).toBe('true');
  expect(await screen.findByText('Transcript for ada-session')).toBeTruthy();
  expect(screen.getByLabelText('Sales notes').getAttribute('placeholder')).toBe('Add notes...');
  expect(screen.getByLabelText('Sales notes')).toHaveProperty('value', 'Interested in security');
  expect(screen.getByLabelText('Tags')).toHaveProperty('value', 'Priority');
  fireEvent.click(grace);
  expect(grace.getAttribute('aria-pressed')).toBe('true');
  expect(ada.getAttribute('aria-pressed')).toBe('false');
  expect(await screen.findByText('Transcript for grace-session')).toBeTruthy();
  expect(screen.queryByText('Transcript for ada-session')).toBeNull();
  expect(screen.getByLabelText('Sales notes')).toHaveProperty('value', '');
  expect(screen.getByLabelText('Tags')).toHaveProperty('value', 'Partner');
});

it('keeps queue controls named and lead selection keyboard-operable through native buttons', async () => {
  const queue = await renderQueue();
  expect(queue.getByRole('textbox', { name: 'Search leads' })).toBeTruthy();
  expect(queue.getByRole('combobox', { name: 'Filter by pipeline status' })).toBeTruthy();
  expect(queue.getByRole('textbox', { name: 'Filter by tag' })).toBeTruthy();

  const ada = queue.getByRole('button', { name: /Ada Lovelace/ });
  expect(ada.tagName).toBe('BUTTON');
  expect(ada.getAttribute('aria-pressed')).toBe('false');
  ada.focus();
  expect(document.activeElement).toBe(ada);

  // A native button's click activation is the browser's keyboard activation path for Enter/Space.
  // Testing Library's jsdom environment does not synthesize that browser default action.
  fireEvent.click(ada);
  expect(ada.getAttribute('aria-pressed')).toBe('true');
  expect(await screen.findByText('Please contact me.')).toBeTruthy();
});

it('keeps existing detail actions available and wired to their handlers', async () => {
  const updateLead = jest.fn().mockResolvedValue(undefined);
  const loadAssist = jest.fn().mockResolvedValue({
    qualification: 'high',
    summary: 'Good fit',
    rationale: [],
    suggestedNextSteps: [],
    followUpDraft: 'Hello',
  });
  const loadBriefPdf = jest.fn().mockResolvedValue(new Blob(['pdf']));
  const loadSlidesPptx = jest.fn().mockResolvedValue(new Blob(['slides']));
  jest.mocked(useLandingLeads).mockReturnValue({
    ...listing,
    bookingUrl: 'https://book.example.com',
    updateLead,
    loadAssist,
    loadBriefPdf,
    loadSlidesPptx,
  });
  const queue = await renderQueue();
  fireEvent.click(queue.getByRole('button', { name: /Ada Lovelace/ }));

  expect(screen.getByText('Identity & qualification')).toBeTruthy();
  expect(screen.getByText('Next actions')).toBeTruthy();
  expect(screen.getByText('Company & conversation insights')).toBeTruthy();

  fireEvent.change(await screen.findByLabelText('Pipeline status'), {
    target: { value: 'contacted' },
  });
  expect(updateLead).toHaveBeenCalledWith('ada', { status: 'contacted' });
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.change(screen.getByLabelText('Sales notes'), { target: { value: 'Follow up Friday' } });
  fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'Priority, Security' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save notes and tags' }));
  expect(updateLead).toHaveBeenCalledWith('ada', {
    notes: 'Follow up Friday',
    tags: ['Priority', 'Security'],
  });

  fireEvent.click(screen.getByRole('button', { name: 'AI lead assist' }));
  expect(loadAssist).toHaveBeenCalledWith('ada-session');
  expect(await screen.findByText(/AI lead assist · high fit/)).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Download meeting brief (PDF)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download meeting slides (PPTX)' }));
  });
  expect(loadBriefPdf).toHaveBeenCalledWith('ada-session');
  expect(loadSlidesPptx).toHaveBeenCalledWith('ada-session');
  const openWindow = jest.spyOn(window, 'open').mockImplementation(() => null);
  fireEvent.click(screen.getByRole('button', { name: 'Book a meeting' }));
  expect(openWindow).toHaveBeenCalledWith(
    expect.stringContaining('name=Ada%20Lovelace&email=ada%40example.com'),
    '_blank',
    'noopener'
  );
  openWindow.mockRestore();
  jest.restoreAllMocks();
});

it('scopes long company sources and detail actions to wrapping styles', async () => {
  const source = `https://example.com/${'very-long-unbroken-company-source-segment-'.repeat(12)}`;
  jest.mocked(useLandingLeads).mockReturnValue({
    ...listing,
    leads: leads.map((lead) =>
      lead.id === 'ada'
        ? { ...lead, companyProfile: { summary: 'Company', sources: [source] } }
        : lead
    ),
  });
  const queue = await renderQueue();
  fireEvent.click(queue.getByRole('button', { name: /Ada Lovelace/ }));

  const sourceText = await screen.findByText(`Sources: ${source}`);
  const section = sourceText.closest('[class]');
  expect(section?.className).toContain('wrappable');
  expect(sourceText.textContent).toContain(source);

  const briefButton = screen.getByRole('button', { name: 'Download meeting brief (PDF)' });
  const slidesButton = screen.getByRole('button', { name: 'Download meeting slides (PPTX)' });
  expect(briefButton.parentElement?.className).toContain('actions');
  expect(slidesButton.parentElement?.className).toContain('actions');
});

it('omits optional identity details when source fields are absent', async () => {
  const queue = await renderQueue();
  fireEvent.click(queue.getByRole('button', { name: /Grace Hopper/ }));
  await screen.findByText('Please contact me.');
  expect(screen.getAllByText('grace@example.com')).toHaveLength(2);
  expect(screen.queryByText('Role')).toBeNull();
  expect(screen.queryByText('Industry')).toBeNull();
  expect(screen.queryByText('Preferred contact')).toBeNull();
  expect(screen.queryByText('Wants to see')).toBeNull();
});

it('runs both decisions for a matched pending demo request', async () => {
  mockGetDemoRequests.mockReturnValue([
    { name: 'ada-demo', email: 'ada@example.com', phase: 'Pending' },
  ]);
  mockApiPost.mockResolvedValue(undefined);
  const queue = await renderQueue();
  fireEvent.click(queue.getByRole('button', { name: /Ada Lovelace/ }));
  await screen.findByText('Please contact me.');

  expect(screen.getByText('A demo request is waiting for a decision.')).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: 'Approve demo' }));
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.click(screen.getByRole('button', { name: 'Reject demo' }));
  expect(mockApiPost).toHaveBeenNthCalledWith(1, 'api/kubo/demorequests/ada-demo/approve');
  expect(mockApiPost).toHaveBeenNthCalledWith(2, 'api/kubo/demorequests/ada-demo/reject');
});

it.each([
  {
    name: 'completed request',
    request: { name: 'ada-demo', email: 'ada@example.com', phase: 'Approved' },
  },
  {
    name: 'unmatched pending request',
    request: { name: 'other-demo', email: 'other@example.com', phase: 'Pending' },
  },
])('hides pending demo guidance and controls for a $name', async ({ request }) => {
  mockGetDemoRequests.mockReturnValue([request]);
  const queue = await renderQueue();
  fireEvent.click(queue.getByRole('button', { name: /Ada Lovelace/ }));
  await screen.findByText('Please contact me.');

  expect(screen.queryByRole('button', { name: 'Approve demo' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Reject demo' })).toBeNull();
  expect(screen.queryByText('A demo request is waiting for a decision.')).toBeNull();
});

it.each(['Ada', 'LOVELACE', 'ada@example.com', 'Analytical', 'SECURITY'])(
  'retains search by contact, company, and notes: %s',
  async (search) => {
    const queue = await renderQueue();
    fireEvent.change(queue.getByLabelText('Search leads'), { target: { value: search } });
    expect(queue.getByRole('button', { name: /Ada Lovelace/ })).toBeTruthy();
    expect(queue.queryByRole('button', { name: /Grace Hopper/ })).toBeNull();
  }
);

it('combines stage and case-insensitive tag filters and distinguishes no matches from no leads', async () => {
  const queue = await renderQueue();
  fireEvent.change(queue.getByLabelText('Filter by pipeline status'), {
    target: { value: 'qualified' },
  });
  fireEvent.change(queue.getByLabelText('Filter by tag'), { target: { value: 'PRIO' } });
  expect(queue.getByRole('button', { name: /Ada Lovelace/ })).toBeTruthy();
  expect(queue.queryByRole('button', { name: /Grace Hopper/ })).toBeNull();
  fireEvent.change(queue.getByLabelText('Search leads'), { target: { value: 'Grace' } });
  expect(queue.getByRole('status').textContent).toContain('No leads match your filters.');
  expect(queue.queryByText('No leads yet.')).toBeNull();
  fireEvent.change(queue.getByLabelText('Search leads'), { target: { value: '' } });
  fireEvent.change(queue.getByLabelText('Filter by pipeline status'), { target: { value: '' } });
  fireEvent.change(queue.getByLabelText('Filter by tag'), { target: { value: '' } });
  expect(queue.getAllByRole('button')).toHaveLength(2);
});

it('filters by stage independently', async () => {
  const queue = await renderQueue();
  fireEvent.change(queue.getByLabelText('Filter by pipeline status'), { target: { value: 'new' } });
  expect(queue.getByRole('button', { name: /Grace Hopper/ })).toBeTruthy();
  expect(queue.queryByRole('button', { name: /Ada Lovelace/ })).toBeNull();
});

it('filters by tag independently using a case-insensitive substring', async () => {
  const queue = await renderQueue();
  fireEvent.change(queue.getByLabelText('Filter by tag'), { target: { value: 'ART' } });
  expect(queue.getByRole('button', { name: /Grace Hopper/ })).toBeTruthy();
  expect(queue.queryByRole('button', { name: /Ada Lovelace/ })).toBeNull();
});

it('shows source contact, company, stage, tags, creation date and email status', async () => {
  const queue = await renderQueue();
  const ada = queue.getByRole('button', { name: /Ada Lovelace/ });
  expect(ada.textContent).toContain('Analytical');
  expect(ada.textContent).toContain('ada@example.com');
  expect(ada.textContent).toContain('qualified');
  expect(ada.textContent).toContain('Priority');
  expect(ada.textContent).toContain(
    new Date('2026-10-20T10:00:00Z').toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  );
  expect(ada.textContent).toContain('Email: sent');
});
/* eslint-enable max-lines */

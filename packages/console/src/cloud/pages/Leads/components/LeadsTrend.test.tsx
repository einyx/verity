import { act, render, screen } from '@testing-library/react';
import { isValidElement, type PropsWithChildren } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import ChartTooltip from '@/components/ChartTooltip';

import type { ChartPoint } from '../lead-stats';

import LeadsTrend, { type LeadsTrendProps } from './LeadsTrend';

jest.mock('recharts', () => ({
  // Model jsdom's zero-size container; individual tests opt into inspecting chart props.
  ResponsiveContainer: jest.fn(() => null),
  AreaChart: jest.fn(({ children }: PropsWithChildren) => <div>{children}</div>),
  Area: jest.fn(() => null),
  CartesianGrid: jest.fn(() => null),
  XAxis: jest.fn(() => null),
  YAxis: jest.fn(() => null),
  Tooltip: jest.fn(() => null),
  Legend: jest.fn(() => null),
}));

const points: readonly ChartPoint[] = Object.freeze([
  Object.freeze({ date: '2026-10-05', count: 3 }),
  Object.freeze({ date: '2026-10-12', count: 8 }),
]);
const summaryLabel = 'New leads per week over the last 12 weeks.';
const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');

const renderChartContents = () => {
  jest.mocked(ResponsiveContainer).mockImplementation(({ children }) => <div>{children}</div>);
};

describe('<LeadsTrend />', () => {
  beforeEach(() => {
    jest.mocked(ResponsiveContainer).mockImplementation(() => <div />);
  });

  afterEach(() => {
    if (originalMatchMedia) {
      // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- restore the browser API descriptor after each isolated test
      Object.defineProperty(window, 'matchMedia', originalMatchMedia);
    } else {
      Reflect.deleteProperty(window, 'matchMedia');
    }
    jest.clearAllMocks();
  });

  it('keeps its accessible summary and dated peak outside the zero-size responsive chart', () => {
    render(<LeadsTrend points={points} summaryLabel={summaryLabel} />);

    expect(screen.getByRole('heading', { name: 'Leads over time', level: 2 })).not.toBeNull();
    expect(screen.getByText('New leads per week')).not.toBeNull();
    expect(
      screen.getByRole('img', {
        name: `${summaryLabel} Peak: 8 leads in the week of Oct 12, 2026.`,
      })
    ).not.toBeNull();
    expect(jest.mocked(AreaChart)).not.toHaveBeenCalled();
  });

  it('keeps an empty series accessible without inventing a peak', () => {
    renderChartContents();
    const props: LeadsTrendProps = { points: [], summaryLabel };
    render(<LeadsTrend {...props} />);

    expect(screen.getByRole('img', { name: summaryLabel })).not.toBeNull();
    expect(jest.mocked(AreaChart).mock.calls[0]?.[0].data).toEqual([]);
  });

  it('describes the actual maximum week rather than the latest week', () => {
    render(
      <LeadsTrend
        points={[{ date: '2026-09-28', count: 15 }, ...points]}
        summaryLabel={summaryLabel}
      />
    );

    expect(
      screen.getByRole('img', {
        name: `${summaryLabel} Peak: 15 leads in the week of Sep 28, 2026.`,
      })
    ).not.toBeNull();
  });

  it('describes a supplied zero-count week without treating it as an empty series', () => {
    render(<LeadsTrend points={[{ date: '2026-10-05', count: 0 }]} summaryLabel={summaryLabel} />);

    expect(
      screen.getByRole('img', {
        name: `${summaryLabel} Peak: 0 leads in the week of Oct 5, 2026.`,
      })
    ).not.toBeNull();
  });

  it('plots every immutable point as one series with the shared tooltip and UTC date labels', () => {
    renderChartContents();
    render(<LeadsTrend points={points} summaryLabel={summaryLabel} />);

    expect(jest.mocked(AreaChart).mock.calls[0]?.[0].data).toEqual(points);
    expect(jest.mocked(Area).mock.calls).toHaveLength(1);
    expect(jest.mocked(Legend)).not.toHaveBeenCalled();
    expect(jest.mocked(CartesianGrid).mock.calls[0]?.[0]).toMatchObject({
      vertical: false,
      stroke: 'var(--color-divider)',
    });
    expect(jest.mocked(Area).mock.calls[0]?.[0]).toMatchObject({
      dataKey: 'count',
      type: 'monotone',
      stroke: 'var(--color-primary)',
      fill: 'var(--color-hover-variant)',
      strokeWidth: 2,
      isAnimationActive: true,
    });
    const axis = jest.mocked(XAxis).mock.calls[0]?.[0];
    expect(axis?.dataKey).toBe('date');
    expect(axis?.tickFormatter?.('2026-10-05', 0)).toBe('Oct 5');
    expect(jest.mocked(YAxis).mock.calls[0]?.[0]).toMatchObject({
      dataKey: 'count',
      axisLine: false,
      tickLine: false,
    });
    const tooltip = jest.mocked(Tooltip).mock.calls[0]?.[0];
    expect(tooltip?.cursor).toEqual({ stroke: 'var(--color-primary)' });
    const content = tooltip?.content;
    expect(isValidElement(content)).toBe(true);
    if (isValidElement(content)) {
      expect(content.type).toBe(ChartTooltip);
    }
  });

  it('disables draw animation for reduced motion and follows preference changes', () => {
    renderChartContents();
    // eslint-disable-next-line @silverhand/fp/no-mutating-assign -- build an isolated observable media-query test double
    const media = Object.assign(new EventTarget(), { matches: true });
    const removeListener = jest.spyOn(media, 'removeEventListener');
    // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- install a browser API double, restored after each test
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: jest.fn(() => media),
    });
    const { unmount } = render(<LeadsTrend points={points} summaryLabel={summaryLabel} />);

    expect(window.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    expect(jest.mocked(Area).mock.lastCall?.[0].isAnimationActive).toBe(false);

    act(() => {
      // eslint-disable-next-line @silverhand/fp/no-mutation -- simulate an OS preference changing on the same MediaQueryList
      media.matches = false;
      media.dispatchEvent(new Event('change'));
    });
    expect(jest.mocked(Area).mock.lastCall?.[0].isAnimationActive).toBe(true);
    unmount();
    expect(removeListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('renders safely when matchMedia is unavailable', () => {
    renderChartContents();
    Reflect.deleteProperty(window, 'matchMedia');
    render(<LeadsTrend points={points} summaryLabel={summaryLabel} />);

    expect(screen.getByRole('img').getAttribute('aria-label')).toContain(summaryLabel);
    expect(jest.mocked(Area).mock.lastCall?.[0].isAnimationActive).toBe(true);
  });
});

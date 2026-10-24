import { type FC, useId, useSyncExternalStore } from 'react';
import {
  Area as AreaBase,
  type AreaProps,
  AreaChart,
  CartesianGrid as CartesianGridBase,
  type CartesianGridProps,
  ResponsiveContainer,
  Tooltip as TooltipBase,
  type TooltipProps,
  XAxis,
  YAxis,
} from 'recharts';

import ChartTooltip from '@/components/ChartTooltip';

import type { ChartPoint } from '../lead-stats';

import styles from './LeadsTrend.module.scss';

export type LeadsTrendProps = {
  readonly points: readonly ChartPoint[];
  /** The accessible summary of the series. The dated peak is appended when available. */
  readonly summaryLabel: string;
};

// eslint-disable-next-line no-restricted-syntax -- recharts 2.x class components fail React 19 JSX checks; the cast keeps their props
const Area = AreaBase as unknown as FC<AreaProps>;
// eslint-disable-next-line no-restricted-syntax -- recharts 2.x class components fail React 19 JSX checks; the cast keeps their props
const CartesianGrid = CartesianGridBase as unknown as FC<CartesianGridProps>;
// eslint-disable-next-line no-restricted-syntax -- recharts 2.x class components fail React 19 JSX checks; the cast keeps their props
const Tooltip = TooltipBase as unknown as FC<TooltipProps<number, string>>;

const tickStyle = {
  fill: 'var(--color-text-secondary)',
  fontSize: 11,
  fontFamily: 'var(--font-family)',
};
const shortDate = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const fullDate = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});
const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
const getMotionMedia = () =>
  typeof window.matchMedia === 'function' ? window.matchMedia(reducedMotionQuery) : undefined;
const getReducedMotion = () => getMotionMedia()?.matches ?? false;
const getServerReducedMotion = () => true;
const subscribeReducedMotion = (onChange: () => void) => {
  const media = getMotionMedia();
  media?.addEventListener('change', onChange);
  return () => {
    media?.removeEventListener('change', onChange);
  };
};

function LeadsTrend({ points, summaryLabel }: LeadsTrendProps) {
  const headingId = useId();
  const prefersReducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotion,
    getServerReducedMotion
  );
  const peak = points.reduce<ChartPoint | undefined>(
    (highest, point) => (!highest || point.count > highest.count ? point : highest),
    undefined
  );
  const accessibleSummary = peak
    ? `${summaryLabel} Peak: ${peak.count} ${peak.count === 1 ? 'lead' : 'leads'} in the week of ${fullDate.format(new Date(peak.date))}.`
    : summaryLabel;

  return (
    <section className={styles.panel} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        Leads over time
      </h2>
      <p className={styles.subtitle}>New leads per week</p>
      <div className={styles.chart} role="img" aria-label={accessibleSummary}>
        <ResponsiveContainer>
          <AreaChart data={[...points]} height={168}>
            <CartesianGrid vertical={false} stroke="var(--color-divider)" />
            <Area
              type="monotone"
              dataKey="count"
              stroke="var(--color-primary)"
              fill="var(--color-hover-variant)"
              strokeWidth={2}
              isAnimationActive={!prefersReducedMotion}
            />
            <XAxis
              dataKey="date"
              tickLine={false}
              tick={tickStyle}
              tickFormatter={(date: string) => shortDate.format(new Date(date))}
            />
            <YAxis dataKey="count" width={35} axisLine={false} tickLine={false} tick={tickStyle} />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--color-primary)' }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export default LeadsTrend;

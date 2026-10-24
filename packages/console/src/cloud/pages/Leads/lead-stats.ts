import type { LeadStats } from '@/cloud/hooks/use-landing-leads';

import { closedStages, leadStages, pipelineStages, stageLabel } from './stages';

export type KpiTile = {
  readonly key: 'total' | 'newThisWeek' | 'qualified' | 'demoRequested';
  readonly label: string;
  readonly value: number;
  /** The change against the previous 7 days. Only present for newThisWeek. */
  readonly delta?: number;
};

export type PipelineRow = {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  /** The share of all leads, from 0 to 1. Zero when there are no leads. */
  readonly share: number;
  readonly isClosed: boolean;
};

export type ChartPoint = {
  readonly date: string;
  readonly count: number;
};

export const toKpiTiles = (stats: LeadStats): readonly KpiTile[] => {
  // Creation time is independent of current stage: recently captured leads may already have moved.
  const last7Days = stats.byStage.reduce((sum, bucket) => sum + bucket.last7Days, 0);
  const previous7Days = stats.byStage.reduce((sum, bucket) => sum + bucket.previous7Days, 0);
  const countFor = (stage: string) =>
    stats.byStage.find((bucket) => bucket.stage === stage)?.count ?? 0;

  return [
    { key: 'total', label: 'Total leads', value: stats.total },
    {
      key: 'newThisWeek',
      label: 'New · 7 days',
      value: last7Days,
      delta: last7Days - previous7Days,
    },
    { key: 'qualified', label: 'Qualified', value: countFor('qualified') },
    { key: 'demoRequested', label: 'Demo requested', value: countFor('demo_requested') },
  ];
};

export const toPipelineRows = (stats: LeadStats): readonly PipelineRow[] => {
  const knownStages = new Set<string>(leadStages);
  const closedStageSet = new Set<string>(closedStages);
  const row = (key: string, count: number, isClosed = false): PipelineRow => ({
    key,
    label: isClosed ? 'Closed / rejected' : stageLabel(key),
    count,
    share: stats.total === 0 ? 0 : count / stats.total,
    isClosed,
  });
  const closedCount = stats.byStage.reduce(
    (sum, bucket) => sum + (closedStageSet.has(bucket.stage) ? bucket.count : 0),
    0
  );

  return [
    ...pipelineStages.map((stage) =>
      row(stage, stats.byStage.find((bucket) => bucket.stage === stage)?.count ?? 0)
    ),
    row('closed', closedCount, true),
    ...stats.byStage
      .filter((bucket) => !knownStages.has(bucket.stage))
      .map((bucket) => row(bucket.stage, bucket.count)),
  ];
};

export const toChartPoints = (stats: LeadStats): readonly ChartPoint[] =>
  stats.byWeek.map(({ weekStart, count }) => ({ date: weekStart, count }));

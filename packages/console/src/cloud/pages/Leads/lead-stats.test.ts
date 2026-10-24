import type { LeadStats } from '@/cloud/hooks/use-landing-leads';

import {
  type ChartPoint,
  type KpiTile,
  type PipelineRow,
  toChartPoints,
  toKpiTiles,
  toPipelineRows,
} from './lead-stats';
import { type LeadStage, closedStages, leadStages, pipelineStages, stageLabel } from './stages';

const stats: LeadStats = {
  total: 608,
  byStage: [
    { stage: 'new', count: 92, last7Days: 24, previous7Days: 18 },
    { stage: 'qualified', count: 147, last7Days: 9, previous7Days: 12 },
    { stage: 'demo_requested', count: 357, last7Days: 4, previous7Days: 2 },
    { stage: 'closed', count: 12, last7Days: 1, previous7Days: 0 },
  ],
  byWeek: [
    { weekStart: '2026-10-05', count: 3 },
    { weekStart: '2026-10-12', count: 8 },
  ],
};
const emptyStats: LeadStats = { total: 0, byStage: [], byWeek: [] };

describe('stages', () => {
  it('defines the ordered pipeline and disjoint closed stages', () => {
    const expectedPipelineStages: readonly LeadStage[] = [
      'new',
      'contacted',
      'qualified',
      'demo_requested',
      'approved',
      'provisioned',
    ];
    expect(pipelineStages).toEqual(expectedPipelineStages);
    expect(closedStages).toEqual(['closed', 'rejected']);
    expect(leadStages).toEqual([...pipelineStages, ...closedStages]);
  });

  it.each([
    ['new', 'New'],
    ['demo_requested', 'Demo requested'],
    ['promoted', 'Promoted'],
    ['future_stage', 'Future_stage'],
    ['', ''],
  ])('labels %s as %s', (stage, label) => {
    expect(stageLabel(stage)).toBe(label);
  });
});

describe('toKpiTiles', () => {
  it('maps four tiles using creation counts across every current stage', () => {
    expect(stats.byStage.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(stats.total);
    const tiles: readonly KpiTile[] = toKpiTiles(stats);
    expect(tiles).toEqual([
      { key: 'total', label: 'Total leads', value: 608 },
      { key: 'newThisWeek', label: 'New · 7 days', value: 38, delta: 6 },
      { key: 'qualified', label: 'Qualified', value: 147 },
      { key: 'demoRequested', label: 'Demo requested', value: 357 },
    ]);
  });

  it('counts newly captured leads that have already moved out of new, including unknown stages', () => {
    const movedStats: LeadStats = {
      total: 5,
      byStage: [
        { stage: 'qualified', count: 2, last7Days: 1, previous7Days: 1 },
        { stage: 'rejected', count: 1, last7Days: 1, previous7Days: 0 },
        { stage: 'future_stage', count: 2, last7Days: 0, previous7Days: 2 },
      ],
      byWeek: [],
    };
    expect(toKpiTiles(movedStats)[1]).toEqual({
      key: 'newThisWeek',
      label: 'New · 7 days',
      value: 2,
      delta: -1,
    });
  });

  it('returns zero values and delta when no buckets exist', () => {
    expect(toKpiTiles(emptyStats)).toEqual([
      { key: 'total', label: 'Total leads', value: 0 },
      { key: 'newThisWeek', label: 'New · 7 days', value: 0, delta: 0 },
      { key: 'qualified', label: 'Qualified', value: 0 },
      { key: 'demoRequested', label: 'Demo requested', value: 0 },
    ]);
  });
});

describe('toPipelineRows', () => {
  it('includes every known pipeline stage in order, even missing buckets', () => {
    const rows: readonly PipelineRow[] = toPipelineRows(stats);
    expect(rows.map(({ key }) => key)).toEqual([...pipelineStages, 'closed']);
    expect(rows.find(({ key }) => key === 'contacted')).toEqual({
      key: 'contacted',
      label: 'Contacted',
      count: 0,
      share: 0,
      isClosed: false,
    });
    expect(rows.find(({ key }) => key === 'qualified')?.share).toBe(147 / 608);
  });

  it('combines closed and rejected exactly once', () => {
    const rows = toPipelineRows({
      ...stats,
      total: stats.total + 4,
      byStage: [...stats.byStage, { stage: 'rejected', count: 4, last7Days: 1, previous7Days: 0 }],
    });
    expect(rows.filter(({ isClosed }) => isClosed)).toEqual([
      { key: 'closed', label: 'Closed / rejected', count: 16, share: 16 / 612, isClosed: true },
    ]);
    expect(rows.some(({ key }) => key === 'rejected')).toBe(false);
    expect(rows.reduce((sum, { count }) => sum + count, 0)).toBe(612);
  });

  it('retains unknown stages in payload order and uses the full total for shares', () => {
    const rows = toPipelineRows({
      ...stats,
      total: stats.total + 10,
      byStage: [
        { stage: 'promoted', count: 5, last7Days: 0, previous7Days: 0 },
        ...stats.byStage,
        { stage: 'future_stage', count: 5, last7Days: 0, previous7Days: 0 },
      ],
    });
    expect(rows.slice(-2)).toEqual([
      { key: 'promoted', label: 'Promoted', count: 5, share: 5 / 618, isClosed: false },
      { key: 'future_stage', label: 'Future_stage', count: 5, share: 5 / 618, isClosed: false },
    ]);
    expect(rows.reduce((sum, { count }) => sum + count, 0)).toBe(618);
    expect(rows.reduce((sum, { share }) => sum + share, 0)).toBeCloseTo(1);
  });

  it('returns all known rows with zero counts and finite zero shares for zero data', () => {
    const rows = toPipelineRows(emptyStats);
    expect(rows.map(({ key }) => key)).toEqual([...pipelineStages, 'closed']);
    expect(rows.every(({ count, share }) => count === 0 && share === 0)).toBe(true);
  });
});

describe('toChartPoints', () => {
  it('maps week buckets in payload order', () => {
    const points: readonly ChartPoint[] = toChartPoints(stats);
    expect(points).toEqual([
      { date: '2026-10-05', count: 3 },
      { date: '2026-10-12', count: 8 },
    ]);
  });

  it('returns no points for zero data', () => {
    expect(toChartPoints(emptyStats)).toEqual([]);
  });
});

it('does not mutate the payload or reuse its bucket objects', () => {
  const frozenStats: LeadStats = Object.freeze({
    ...stats,
    byStage: Object.freeze(stats.byStage.map((bucket) => Object.freeze({ ...bucket }))),
    byWeek: Object.freeze(stats.byWeek.map((bucket) => Object.freeze({ ...bucket }))),
  });
  const before = JSON.stringify(frozenStats);
  toKpiTiles(frozenStats);
  toPipelineRows(frozenStats);
  const points = toChartPoints(frozenStats);
  expect(JSON.stringify(frozenStats)).toBe(before);
  expect(points[0]).not.toBe(frozenStats.byWeek[0]);
});

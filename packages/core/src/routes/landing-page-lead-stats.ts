export type DailyLeadCount = {
  /** A UTC calendar day, as YYYY-MM-DD. */
  readonly day: string;
  readonly count: number;
};

export type LeadStageBucket = {
  readonly stage: string;
  readonly count: number;
  readonly last7Days: number;
  readonly previous7Days: number;
};

type LeadWeekBucket = {
  /** The UTC Monday starting this week, as YYYY-MM-DD. */
  readonly weekStart: string;
  readonly count: number;
};

export type LeadStats = {
  readonly total: number;
  readonly byStage: readonly LeadStageBucket[];
  readonly byWeek: readonly LeadWeekBucket[];
};

type CompleteWeeks = {
  readonly from: Date;
  readonly to: Date;
  /** UTC Mondays, oldest first. The upper boundary is exclusive. */
  readonly weekStarts: readonly string[];
};

const dayMilliseconds = 24 * 60 * 60 * 1000;
const weekMilliseconds = 7 * dayMilliseconds;

const utcMonday = (date: Date): Date => {
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return new Date(midnight - ((date.getUTCDay() + 6) % 7) * dayMilliseconds);
};

/** The most recent complete UTC weeks; the current week is always excluded. */
export const completeWeeks = (now: Date, weekCount: number): CompleteWeeks => {
  const to = utcMonday(now);
  const from = new Date(to.getTime() - weekCount * weekMilliseconds);
  const weekStarts = Array.from({ length: weekCount }, (_, index) =>
    new Date(from.getTime() + index * weekMilliseconds).toISOString().slice(0, 10)
  );
  return { from, to, weekStarts };
};

/** Bucket daily creation counts, retaining empty weeks and ignoring out-of-range days. */
export const toWeekBuckets = (
  daily: readonly DailyLeadCount[],
  weeks: CompleteWeeks
): readonly LeadWeekBucket[] => {
  const counts = daily.reduce((buckets, { day, count }) => {
    const monday = utcMonday(new Date(`${day}T00:00:00.000Z`))
      .toISOString()
      .slice(0, 10);
    return new Map([...buckets, [monday, (buckets.get(monday) ?? 0) + count]]);
  }, new Map<string, number>());

  return weeks.weekStarts.map((weekStart) => ({ weekStart, count: counts.get(weekStart) ?? 0 }));
};

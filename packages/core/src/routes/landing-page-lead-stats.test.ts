import { completeWeeks, toWeekBuckets } from './landing-page-lead-stats.js';

describe('completeWeeks', () => {
  it('returns twelve complete UTC weeks, oldest first, without changing now', () => {
    const now = new Date('2026-10-23T12:00:00.000Z');
    const weeks = completeWeeks(now, 12);

    expect(weeks.weekStarts).toHaveLength(12);
    expect(weeks.weekStarts[0]).toBe('2026-07-27');
    expect(weeks.weekStarts.at(-1)).toBe('2026-10-12');
    expect(weeks.from.toISOString()).toBe('2026-07-27T00:00:00.000Z');
    expect(weeks.to.toISOString()).toBe('2026-10-19T00:00:00.000Z');
    expect(now.toISOString()).toBe('2026-10-23T12:00:00.000Z');
    expect(weeks.weekStarts.every((day) => new Date(`${day}T00:00:00Z`).getUTCDay() === 1)).toBe(
      true
    );
  });

  it.each([
    ['2026-10-18T23:59:59.999Z', '2026-10-12'],
    ['2026-10-19T00:00:00.000Z', '2026-10-19'],
    ['2026-10-18T20:00:00-07:00', '2026-10-19'],
    ['2027-01-01T12:00:00Z', '2026-12-28'],
    ['2024-03-01T12:00:00Z', '2024-02-26'],
  ])('uses UTC Monday at date boundaries for %s', (now, monday) => {
    const weeks = completeWeeks(new Date(now), 1);
    expect(weeks.to.toISOString()).toBe(`${monday}T00:00:00.000Z`);
    expect(weeks.to.getTime() - weeks.from.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('supports an empty week range', () => {
    const weeks = completeWeeks(new Date('2026-10-23T12:00:00Z'), 0);
    expect(weeks.weekStarts).toEqual([]);
    expect(weeks.from).toEqual(weeks.to);
    expect(toWeekBuckets([], weeks)).toEqual([]);
  });
});

describe('toWeekBuckets', () => {
  const weeks = completeWeeks(new Date('2026-10-23T12:00:00Z'), 3);

  it('groups Monday through Sunday and retains zero weeks without mutating input', () => {
    const daily = Object.freeze([
      Object.freeze({ day: '2026-10-12', count: 4 }),
      Object.freeze({ day: '2026-10-18', count: 1 }),
      Object.freeze({ day: '2026-09-28', count: 2 }),
    ]);
    expect(toWeekBuckets(daily, weeks)).toEqual([
      { weekStart: '2026-09-28', count: 2 },
      { weekStart: '2026-10-05', count: 0 },
      { weekStart: '2026-10-12', count: 5 },
    ]);
    expect(daily[0]).toEqual({ day: '2026-10-12', count: 4 });
  });

  it('zero fills empty input', () => {
    expect(toWeekBuckets([], weeks)).toEqual([
      { weekStart: '2026-09-28', count: 0 },
      { weekStart: '2026-10-05', count: 0 },
      { weekStart: '2026-10-12', count: 0 },
    ]);
  });

  it('excludes days before the range and the in-progress week', () => {
    expect(
      toWeekBuckets(
        [
          { day: '2026-09-27', count: 100 },
          { day: '2026-10-19', count: 100 },
          { day: '2026-10-23', count: 100 },
        ],
        weeks
      )
    ).toEqual(toWeekBuckets([], weeks));
  });
});

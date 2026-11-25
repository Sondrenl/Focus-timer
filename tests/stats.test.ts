import { describe, it, expect } from 'vitest';
import {
  filterPeriodSessions,
  computeFocusTotals,
  computeTagDistribution,
  computeActivityBars,
  computeProductiveMetric,
  getEffectiveSessionDate,
} from '../src/utils/stats/focusStats';
import { computeDayTimeRangeBreakdown } from '../src/utils/stats/dayTimeRanges';
import { buildInsightContext } from '../src/utils/insights/mathHelpers';
import {
  filterPeriodCoffee,
  computeCoffeeStats,
} from '../src/utils/stats/coffeeStats';
import {
  getAdjacentReferenceDate,
  checkIsCurrentPeriod,
  checkCanGoNext,
  computePeriodBounds,
} from '../src/utils/stats/periodBounds';
import { StatCoffeeCup, StatSession } from '../src/utils/stats/types';
import { Tag } from '../src/types/tag';
import { toDateKey } from '../src/utils/dates';

function localIso(
  year: number,
  month1Based: number,
  day: number,
  hour: number,
  minute = 0,
  second = 0
): string {
  return new Date(year, month1Based - 1, day, hour, minute, second).toISOString();
}

const sampleTags: Tag[] = [
  {
    id: 'tag-dev',
    name: 'Development',
    color: '#3B82F6',
    isArchived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'tag-bad-color',
    name: 'Legacy',
    color: 'javascript:alert(1)',
    isArchived: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

describe('periodBounds', () => {
  it('clamps month-end and leap-year dates safely during navigation', () => {
    const jan31 = new Date(2026, 0, 31, 12, 0, 0);
    const nextMonth = getAdjacentReferenceDate(jan31, 'month', 'next');
    expect(nextMonth.getFullYear()).toBe(2026);
    expect(nextMonth.getMonth()).toBe(1);
    expect(nextMonth.getDate()).toBe(28);

    const feb29Leap = new Date(2024, 1, 29, 12, 0, 0);
    const nextYear = getAdjacentReferenceDate(feb29Leap, 'year', 'next');
    expect(nextYear.getFullYear()).toBe(2025);
    expect(nextYear.getMonth()).toBe(1);
    expect(nextYear.getDate()).toBe(28);
  });

  it('sanitizes reversed custom ranges and computes period labels', () => {
    const bounds = computePeriodBounds('custom', new Date(2026, 10, 10), {
      start: '2026-11-15',
      end: '2026-11-10',
    });

    expect(bounds.sanitizedCustomRange).toEqual({
      start: '2026-11-10',
      end: '2026-11-15',
    });
    expect(toDateKey(bounds.startDate)).toBe('2026-11-10');
    expect(toDateKey(bounds.endDate)).toBe('2026-11-15');
  });

  it('evaluates current period and forward navigation bounds accurately', () => {
    const todayKey = '2026-11-15';
    expect(checkIsCurrentPeriod('day', new Date(2026, 10, 15, 12), todayKey)).toBe(true);
    expect(checkCanGoNext('day', new Date(2026, 10, 15, 12), todayKey)).toBe(false);
    expect(checkCanGoNext('day', new Date(2026, 10, 14, 12), todayKey)).toBe(true);
    expect(checkCanGoNext('all', new Date(2026, 10, 14, 12), todayKey)).toBe(false);
    expect(checkCanGoNext('custom', new Date(2026, 10, 14, 12), todayKey)).toBe(false);
  });
});

describe('focusStats', () => {
  it('filters sessions by period bounds and separates WORK from break sessions', () => {
    const start = new Date(2026, 10, 15, 0, 0, 0, 0);
    const end = new Date(2026, 10, 15, 23, 59, 59, 999);
    const sessions: StatSession[] = [
      { id: 'real-1', sessionType: 'WORK', durationSeconds: 1500, completedAt: localIso(2026, 11, 15, 10, 0) },
      { id: 'real-break', sessionType: 'SHORT_BREAK', durationSeconds: 300, completedAt: localIso(2026, 11, 15, 10, 5) },
      { id: 'out-of-range', sessionType: 'WORK', durationSeconds: 1500, completedAt: localIso(2026, 11, 14, 23, 0) },
    ];

    const result = filterPeriodSessions(sessions, start, end);
    expect(result.periodAllSessions.map((s) => s.id)).toEqual(['real-1', 'real-break']);
    expect(result.filteredSessions.map((s) => s.id)).toEqual(['real-1']);
  });

  it('computes totals safely with negative/zero durations clamped and sanitizes tag colors', () => {
    const sessions: StatSession[] = [
      { id: 's1', tagId: 'tag-dev', sessionType: 'WORK', durationSeconds: 1800, completedAt: localIso(2026, 11, 15, 10, 0) },
      { id: 's2', tagId: 'tag-bad-color', sessionType: 'WORK', durationSeconds: 600, completedAt: localIso(2026, 11, 15, 11, 0) },
      { id: 's3', tagId: 'deleted-tag', sessionType: 'WORK', durationSeconds: -300, completedAt: localIso(2026, 11, 15, 12, 0) },
    ];

    const totals = computeFocusTotals(sessions);
    expect(totals.totalFocusSeconds).toBe(2400);
    expect(totals.totalWorkCount).toBe(3);

    const dist = computeTagDistribution(sessions, sampleTags, totals.totalFocusSeconds);
    const dev = dist.find((d) => d.tagId === 'tag-dev');
    const badColor = dist.find((d) => d.tagId === 'tag-bad-color');
    const unassigned = dist.find((d) => d.tagId === 'unassigned');

    expect(dev?.percentage).toBe(75);
    expect(dev?.color).toBe('#3B82F6');
    expect(badColor?.color).toBe('#BDBDBD');
    expect(badColor?.isArchived).toBe(true);
    expect(unassigned?.name).toBe('Unassigned');
  });

  it('attributes only Day D [00:00, 24:00] overlap for cross-midnight sessions in day bars and peak hour', () => {
    const refDate = new Date(2026, 10, 15, 12, 0, 0);
    const startDate = new Date(2026, 10, 15, 0, 0, 0, 0);
    // Session ran from 2026-11-14 23:45 to 2026-11-15 00:15 (30m total: 15m yesterday, 15m today)
    const sessions: StatSession[] = [
      {
        id: 'midnight-1',
        tagId: 'tag-dev',
        sessionType: 'WORK',
        durationSeconds: 1800,
        completedAt: localIso(2026, 11, 15, 0, 15),
      },
    ];

    const bars = computeActivityBars(sessions, 'day', refDate, startDate, {
      start: '2026-11-15',
      end: '2026-11-15',
    });

    const hour0 = bars.find((b) => b.key === 'hour-0');
    const hour23 = bars.find((b) => b.key === 'hour-23');
    expect(hour0?.totalSeconds).toBe(900);
    expect(hour0?.sessionCount).toBe(1);
    expect(hour23?.totalSeconds).toBe(0);

    const peak = computeProductiveMetric(sessions, bars, 'day', refDate, true);
    expect(peak.hasData).toBe(true);
    expect(peak.value).toBe('00:00 – 01:00');
    expect(peak.subtext).toBe('15m focused');
  });

  it('attributes exact-midnight (00:00:00.000) sessions to the preceding day without losing duration to 0s overlap', () => {
    // Started 2026-11-14 23:35:00, completed 2026-11-15 00:00:00.000 (25m total on Nov 14)
    const sessions: StatSession[] = [
      {
        id: 'exact-midnight-1',
        tagId: 'tag-dev',
        sessionType: 'WORK',
        durationSeconds: 1500,
        completedAt: localIso(2026, 11, 15, 0, 0, 0),
      },
    ];

    const nov14Start = new Date(2026, 10, 14, 0, 0, 0, 0);
    const nov14End = new Date(2026, 10, 14, 23, 59, 59, 999);
    const nov15Start = new Date(2026, 10, 15, 0, 0, 0, 0);
    const nov15End = new Date(2026, 10, 15, 23, 59, 59, 999);

    const nov14Filtered = filterPeriodSessions(sessions, nov14Start, nov14End);
    const nov15Filtered = filterPeriodSessions(sessions, nov15Start, nov15End);

    expect(nov14Filtered.filteredSessions.map((s) => s.id)).toEqual(['exact-midnight-1']);
    expect(nov15Filtered.filteredSessions).toHaveLength(0);

    const refNov14 = new Date(2026, 10, 14, 12, 0, 0);
    const bars = computeActivityBars(nov14Filtered.filteredSessions, 'day', refNov14, nov14Start, {
      start: '2026-11-14',
      end: '2026-11-14',
    });

    const hour23 = bars.find((b) => b.key === 'hour-23');
    const hour0 = bars.find((b) => b.key === 'hour-0');
    expect(hour23?.totalSeconds).toBe(1500);
    expect(hour23?.sessionCount).toBe(1);
    expect(hour0?.totalSeconds).toBe(0);

    const peak = computeProductiveMetric(nov14Filtered.filteredSessions, bars, 'day', refNov14, false);
    expect(peak.hasData).toBe(true);
    expect(peak.value).toBe('23:00 – 00:00');
    expect(peak.subtext).toBe('25m focused');
  });

  it('computes week activity bars and most productive day accurately', () => {
    const refDate = new Date(2026, 10, 11, 12, 0, 0); // Wednesday
    const { startDate, sanitizedCustomRange } = computePeriodBounds('week', refDate, {
      start: '2026-11-09',
      end: '2026-11-15',
    });
    const sessions: StatSession[] = [
      { id: 'w1', sessionType: 'WORK', durationSeconds: 1500, completedAt: localIso(2026, 11, 9, 10, 0) },
      { id: 'w2', sessionType: 'WORK', durationSeconds: 3600, completedAt: localIso(2026, 11, 11, 14, 0) },
    ];

    const bars = computeActivityBars(sessions, 'week', refDate, startDate, sanitizedCustomRange);
    expect(bars).toHaveLength(7);
    expect(bars[0].totalSeconds).toBe(1500);
    expect(bars[2].totalSeconds).toBe(3600);

    const metric = computeProductiveMetric(sessions, bars, 'week', refDate, false);
    expect(metric.title).toBe('Most Productive Day');
    expect(metric.value).toBe('Wed 11');
  });
});

describe('coffeeStats', () => {
  it('filters coffee cups by period bounds', () => {
    const start = new Date(2026, 10, 1, 0, 0, 0, 0);
    const end = new Date(2026, 10, 7, 23, 59, 59, 999);
    const cups: StatCoffeeCup[] = [
      { id: 'cup-1', date: '2026-11-02', tagId: 'tag-dev' },
      { date: '2026-11-04', tagId: null },
      { id: 'cup-out', date: '2026-11-10', tagId: 'tag-dev' },
    ];

    const filtered = filterPeriodCoffee(cups, start, end);
    expect(filtered.map((c) => c.id ?? 'no-id')).toEqual(['cup-1', 'no-id']);
  });

  it('computes coffee totals, averages, and peak metric', () => {
    const refDate = new Date(2026, 10, 4, 12, 0, 0);
    const { startDate, endDate, sanitizedCustomRange } = computePeriodBounds('week', refDate, {
      start: '2026-11-02',
      end: '2026-11-08',
    });

    const cups: StatCoffeeCup[] = [
      { id: 'cup-1', date: '2026-11-02', tagId: 'tag-dev' },
      { id: 'cup-2', date: '2026-11-04', tagId: 'tag-dev' },
      { id: 'cup-3', date: '2026-11-04', tagId: 'tag-dev' },
    ];

    const stats = computeCoffeeStats({
      coffeeCups: cups,
      periodType: 'week',
      referenceDate: refDate,
      startDate,
      endDate,
      sanitizedCustomRange,
      todayKey: '2026-11-04', // 3 elapsed days: Nov 2, 3, 4
      tags: sampleTags,
    });

    expect(stats.totalCoffeeCups).toBe(3);
    expect(stats.coffeeDailyAverage).toBe(1);
    expect(stats.coffeePeakMetric.value).toBe('Wednesday');
    expect(stats.coffeePeakMetric.subtext).toBe('2 cups logged');
  });

  it('attributes cross-midnight, exact-midnight (00:00:00.000), and DST coffee peak weekday consistently', () => {
    const crossMidnight: StatSession[] = [
      { id: 'cm-1', tagId: 'tag-dev', sessionType: 'WORK', durationSeconds: 1500, completedAt: localIso(2026, 11, 15, 0, 10) },
    ];
    const nov14Start = new Date(2026, 10, 14, 0, 0, 0, 0);
    const nov14Bars = computeActivityBars([], 'day', new Date(2026, 10, 14, 12, 0, 0), nov14Start, { start: '2026-11-14', end: '2026-11-14' }, crossMidnight);
    expect(nov14Bars.find((b) => b.key === 'hour-23')?.totalSeconds).toBe(900);
    expect(computeProductiveMetric([], nov14Bars, 'day', new Date(2026, 10, 14, 12, 0, 0), false).subtext).toBe('15m focused');

    const exactMidnight: StatSession = {
      id: 'em-1', tagId: null, sessionType: 'WORK', durationSeconds: 1500,
      completedAt: new Date(2026, 10, 15, 0, 0, 0, 0).toISOString(),
    };
    expect(toDateKey(getEffectiveSessionDate(exactMidnight.completedAt, 1500)!)).toBe('2026-11-14');
    expect(getEffectiveSessionDate(new Date(2026, 10, 15, 0, 0, 0, 1).toISOString(), 1500)?.getDate()).toBe(15);
    expect(buildInsightContext({ sessions: [exactMidnight], coffeeCups: [], tags: [], periodType: 'week', totalFocusSeconds: 1500, allSessions: [exactMidnight] }).activeFocusDates).toEqual(['2026-11-14']);

    const byRange = Object.fromEntries(computeDayTimeRangeBreakdown([exactMidnight as any]).map((r) => [r.id, r.totalSeconds]));
    expect(byRange.night).toBe(1500);

    const coffee = computeCoffeeStats({
      coffeeCups: [{ id: 'c1', date: '2026-03-08', tagId: null }, { id: 'c2', date: '2026-03-08', tagId: null }, { id: 'c3', date: '2026-03-09', tagId: null }],
      periodType: 'all', referenceDate: new Date(2026, 2, 10, 12, 0, 0),
      startDate: new Date(2026, 0, 1, 0, 0, 0), endDate: new Date(2026, 2, 10, 23, 59, 59),
      sanitizedCustomRange: { start: '2026-03-08', end: '2026-03-10' }, todayKey: '2026-03-10', tags: [],
    });
    expect(coffee.coffeePeakMetric.value).toBe('Sundays');
  });

  it('handles malformed custom ranges, caps extreme custom spans, and computes extreme all-time coffee peaks without hanging', () => {
    const refDate = new Date(2026, 10, 15, 12, 0, 0);

    // Malformed custom keys fall back safely to valid dates
    const badBounds = computePeriodBounds('custom', refDate, { start: 'not-a-date', end: '' });
    expect(Number.isNaN(badBounds.startDate.getTime())).toBe(false);
    expect(Number.isNaN(badBounds.endDate.getTime())).toBe(false);

    // Extreme 126-year custom span is capped at 3660 days (3661 bars max)
    const hugeBars = computeActivityBars([], 'custom', refDate, new Date(1900, 0, 1), {
      start: '1900-01-01',
      end: '2026-11-15',
    });
    expect(hugeBars.length).toBeLessThanOrEqual(3661);

    // Extreme 56-year all-time coffee span computes peak weekday via O(1) math
    const extremeCoffee = computeCoffeeStats({
      coffeeCups: [
        { id: 'old-1', date: '1970-01-01', tagId: null }, // Thursday
        { id: 'new-1', date: '2026-11-12', tagId: null }, // Thursday
      ],
      periodType: 'all',
      referenceDate: refDate,
      startDate: new Date(1970, 0, 1),
      endDate: refDate,
      sanitizedCustomRange: { start: '1970-01-01', end: '2026-11-15' },
      todayKey: '2026-11-15',
      tags: [],
    });
    expect(extremeCoffee.coffeePeakMetric.hasData).toBe(true);
    expect(extremeCoffee.coffeePeakMetric.value).toBe('Thursdays');
  });
});

import { CompletedSession } from '../../types/session';
import { ActivityBarStat } from './types';

export type DayTimeRangeId = 'morning' | 'midday' | 'afternoon' | 'evening' | 'night';

export interface DayTimeRangeBucket {
  id: DayTimeRangeId;
  title: string;
  timeRange: string;
  totalSeconds: number;
}

export const DAY_TIME_RANGES: readonly {
  id: DayTimeRangeId;
  title: string;
  timeRange: string;
}[] = [
  { id: 'morning', title: 'Morning', timeRange: '06:00 – 10:00' },
  { id: 'midday', title: 'Midday', timeRange: '10:00 – 14:00' },
  { id: 'afternoon', title: 'Afternoon', timeRange: '14:00 – 18:00' },
  { id: 'evening', title: 'Evening', timeRange: '18:00 – 22:00' },
  { id: 'night', title: 'Night', timeRange: '22:00 – 06:00' },
];

/**
 * Splits each WORK session across the 5 daily time ranges by exact elapsed-time
 * interval overlap ([completedAt - durationSeconds, completedAt]), rather than
 * attributing the entire session to the hour it finished.
 *
 * Ranges (local time):
 * - Morning:   06:00 – 10:00
 * - Midday:    10:00 – 14:00
 * - Afternoon: 14:00 – 18:00
 * - Evening:   18:00 – 22:00
 * - Night:     22:00 – 06:00
 */
export function computeDayTimeRangeBreakdown(
  sessions: CompletedSession[] = [],
  fallbackHourlyBars: ActivityBarStat[] = []
): DayTimeRangeBucket[] {
  const totals: Record<DayTimeRangeId, number> = {
    morning: 0,
    midday: 0,
    afternoon: 0,
    evening: 0,
    night: 0,
  };

  const workSessions = sessions.filter((s) => s.sessionType === 'WORK' && s.durationSeconds > 0);

  if (workSessions.length > 0) {
    for (const session of workSessions) {
      const endDate = new Date(session.completedAt);
      if (Number.isNaN(endDate.getTime())) continue;

      const endMs = endDate.getTime();
      const startMs = endMs - session.durationSeconds * 1000;
      if (endMs <= startMs) continue;

      const y = endDate.getFullYear();
      const m = endDate.getMonth();
      const d = endDate.getDate();

      const atHour = (dayOffset: number, hour: number) =>
        new Date(y, m, d + dayOffset, hour, 0, 0, 0).getTime();

      // Contiguous local-time windows covering up to 24h before midnight through end of completion day
      const windows: { id: DayTimeRangeId; start: number; end: number }[] = [
        { id: 'night', start: atHour(-1, 0), end: atHour(-1, 6) },
        { id: 'morning', start: atHour(-1, 6), end: atHour(-1, 10) },
        { id: 'midday', start: atHour(-1, 10), end: atHour(-1, 14) },
        { id: 'afternoon', start: atHour(-1, 14), end: atHour(-1, 18) },
        { id: 'evening', start: atHour(-1, 18), end: atHour(-1, 22) },
        { id: 'night', start: atHour(-1, 22), end: atHour(0, 6) },
        { id: 'morning', start: atHour(0, 6), end: atHour(0, 10) },
        { id: 'midday', start: atHour(0, 10), end: atHour(0, 14) },
        { id: 'afternoon', start: atHour(0, 14), end: atHour(0, 18) },
        { id: 'evening', start: atHour(0, 18), end: atHour(0, 22) },
        { id: 'night', start: atHour(0, 22), end: atHour(1, 0) },
      ];

      for (const win of windows) {
        const overlapStart = Math.max(startMs, win.start);
        const overlapEnd = Math.min(endMs, win.end);
        if (overlapEnd > overlapStart) {
          totals[win.id] += (overlapEnd - overlapStart) / 1000;
        }
      }
    }
  } else if (fallbackHourlyBars.length > 0) {
    // Fallback if only pre-aggregated hourly bars are supplied
    for (const bar of fallbackHourlyBars) {
      if (bar.totalSeconds <= 0) continue;
      const match = bar.key.match(/hour-(\d+)/) || bar.label.match(/^(\d+):/);
      const h = match ? parseInt(match[1], 10) : NaN;
      if (Number.isNaN(h)) continue;

      if (h >= 6 && h < 10) {
        totals.morning += bar.totalSeconds;
      } else if (h >= 10 && h < 14) {
        totals.midday += bar.totalSeconds;
      } else if (h >= 14 && h < 18) {
        totals.afternoon += bar.totalSeconds;
      } else if (h >= 18 && h < 22) {
        totals.evening += bar.totalSeconds;
      } else {
        totals.night += bar.totalSeconds;
      }
    }
  }

  return DAY_TIME_RANGES.map((def) => ({
    ...def,
    totalSeconds: Math.round(totals[def.id]),
  }));
}

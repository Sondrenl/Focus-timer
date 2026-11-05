import { Tag } from '../../types/tag';
import { toDateKey, WEEKDAY_NAMES, MONTH_NAMES } from '../dates';
import { formatDurationHoursMins } from '../formatters';
import {
  ActivityBarStat,
  CustomDateRange,
  ProductiveMetric,
  StatSession,
  TagStat,
  TimePeriodType,
} from './types';

/**
 * Filters all sessions and WORK sessions within the given period bounds,
 * excluding dev sample/seed sessions when appropriate.
 */
export function filterPeriodSessions<T extends StatSession>(
  sessions: T[],
  startDate: Date,
  endDate: Date,
  shouldExcludeSample: boolean
): { periodAllSessions: T[]; filteredSessions: T[] } {
  const periodAllSessions = sessions.filter((s) => {
    if (
      shouldExcludeSample &&
      (s.id.startsWith('seed-session-') ||
        s.id.startsWith('sample-session-') ||
        s.id.startsWith('sample-') ||
        s.id.startsWith('seed-'))
    ) {
      return false;
    }
    if (!s.completedAt) return false;
    const d = new Date(s.completedAt);
    if (isNaN(d.getTime())) return false;
    return d >= startDate && d <= endDate;
  });

  const filteredSessions = periodAllSessions.filter((s) => s.sessionType === 'WORK');

  return { periodAllSessions, filteredSessions };
}

/**
 * Computes total focus seconds, focus hours (rounded to 1 decimal), and work session count.
 */
export function computeFocusTotals(filteredSessions: StatSession[]): {
  totalFocusSeconds: number;
  totalFocusHours: number;
  totalWorkCount: number;
} {
  const totalFocusSeconds = filteredSessions.reduce(
    (acc, s) => acc + (s.durationSeconds > 0 ? s.durationSeconds : 0),
    0
  );
  const totalFocusHours = Number((totalFocusSeconds / 3600).toFixed(1));
  const totalWorkCount = filteredSessions.length;

  return { totalFocusSeconds, totalFocusHours, totalWorkCount };
}

/**
 * Computes tag distribution statistics sorted by descending focus duration.
 */
export function computeTagDistribution(
  filteredSessions: StatSession[],
  tags: Tag[],
  totalFocusSeconds: number
): TagStat[] {
  const tagMap = new Map<string, Tag>();
  tags.forEach((t) => tagMap.set(t.id, t));

  const tagSecondsMap = new Map<string, { seconds: number; count: number }>();
  filteredSessions.forEach((s) => {
    const tagId = s.tagId && tagMap.has(s.tagId) ? s.tagId : 'unassigned';
    const curr = tagSecondsMap.get(tagId) || { seconds: 0, count: 0 };
    curr.seconds += s.durationSeconds > 0 ? s.durationSeconds : 0;
    curr.count += 1;
    tagSecondsMap.set(tagId, curr);
  });

  return Array.from(tagSecondsMap.entries())
    .map(([tagId, data]) => {
      const foundTag = tagMap.get(tagId);
      const name = tagId === 'unassigned' ? 'Unassigned' : foundTag ? foundTag.name : 'Unknown Tag';
      const color = tagId === 'unassigned' ? '#9E9E9E' : foundTag ? foundTag.color : '#BDBDBD';
      const isArchived = foundTag ? foundTag.isArchived : false;
      const hours = Number((data.seconds / 3600).toFixed(1));
      const percentage =
        totalFocusSeconds > 0 ? Math.round((data.seconds / totalFocusSeconds) * 100) : 0;

      return {
        tagId,
        name,
        color,
        isArchived,
        totalSeconds: data.seconds,
        hours,
        percentage,
        sessionCount: data.count,
      };
    })
    .sort((a, b) => b.totalSeconds - a.totalSeconds);
}

/**
 * Computes activity bar chart buckets for the selected period type.
 */
export function computeActivityBars(
  filteredSessions: StatSession[],
  periodType: TimePeriodType,
  referenceDate: Date,
  startDate: Date,
  sanitizedCustomRange: CustomDateRange
): ActivityBarStat[] {
  if (periodType === 'day') {
    const hoursArray = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      seconds: 0,
      count: 0,
    }));

    filteredSessions.forEach((s) => {
      const d = new Date(s.completedAt);
      const h = d.getHours();
      if (hoursArray[h]) {
        hoursArray[h].seconds += s.durationSeconds > 0 ? s.durationSeconds : 0;
        hoursArray[h].count += 1;
      }
    });

    return hoursArray.map((item) => ({
      key: `hour-${item.hour}`,
      label: `${item.hour.toString().padStart(2, '0')}:00`,
      totalSeconds: item.seconds,
      hours: Number((item.seconds / 3600).toFixed(1)),
      sessionCount: item.count,
    }));
  }

  if (periodType === 'week') {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      return {
        date: d,
        dateKey: toDateKey(d),
        label: WEEKDAY_NAMES[d.getDay()].slice(0, 3),
        seconds: 0,
        count: 0,
      };
    });

    filteredSessions.forEach((s) => {
      const key = toDateKey(s.completedAt);
      const target = days.find((d) => d.dateKey === key);
      if (target) {
        target.seconds += s.durationSeconds > 0 ? s.durationSeconds : 0;
        target.count += 1;
      }
    });

    return days.map((item) => ({
      key: item.dateKey,
      label: item.label,
      subLabel: `${item.date.getDate()}`,
      totalSeconds: item.seconds,
      hours: Number((item.seconds / 3600).toFixed(1)),
      sessionCount: item.count,
    }));
  }

  if (periodType === 'month') {
    const daysInMonth = new Date(
      referenceDate.getFullYear(),
      referenceDate.getMonth() + 1,
      0
    ).getDate();
    const monthShort = MONTH_NAMES[referenceDate.getMonth()].slice(0, 3);
    const monthDays = Array.from({ length: daysInMonth }, (_, i) => {
      const d = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), i + 1);
      return {
        dateKey: toDateKey(d),
        dayNum: i + 1,
        seconds: 0,
        count: 0,
      };
    });

    filteredSessions.forEach((s) => {
      const key = toDateKey(s.completedAt);
      const target = monthDays.find((d) => d.dateKey === key);
      if (target) {
        target.seconds += s.durationSeconds > 0 ? s.durationSeconds : 0;
        target.count += 1;
      }
    });

    return monthDays.map((item) => ({
      key: item.dateKey,
      label: `${item.dayNum}`,
      subLabel: monthShort,
      totalSeconds: item.seconds,
      hours: Number((item.seconds / 3600).toFixed(1)),
      sessionCount: item.count,
    }));
  }

  if (periodType === 'year') {
    const months = Array.from({ length: 12 }, (_, i) => ({
      monthIdx: i,
      label: MONTH_NAMES[i].slice(0, 3),
      seconds: 0,
      count: 0,
    }));

    filteredSessions.forEach((s) => {
      const m = new Date(s.completedAt).getMonth();
      if (months[m]) {
        months[m].seconds += s.durationSeconds > 0 ? s.durationSeconds : 0;
        months[m].count += 1;
      }
    });

    return months.map((item) => ({
      key: `month-${item.monthIdx}`,
      label: item.label,
      totalSeconds: item.seconds,
      hours: Number((item.seconds / 3600).toFixed(1)),
      sessionCount: item.count,
    }));
  }

  if (periodType === 'all') {
    const sessionYears = Array.from(
      new Set(filteredSessions.map((s) => new Date(s.completedAt).getFullYear()))
    ).sort((a, b) => a - b);

    if (sessionYears.length <= 1) {
      const yr = sessionYears[0] || new Date().getFullYear();
      const months = Array.from({ length: 12 }, (_, i) => ({
        monthIdx: i,
        label: MONTH_NAMES[i].slice(0, 3),
        subLabel: `${yr}`,
        seconds: 0,
        count: 0,
      }));

      filteredSessions.forEach((s) => {
        const m = new Date(s.completedAt).getMonth();
        if (months[m]) {
          months[m].seconds += s.durationSeconds > 0 ? s.durationSeconds : 0;
          months[m].count += 1;
        }
      });

      return months.map((item) => ({
        key: `all-month-${item.monthIdx}`,
        label: item.label,
        subLabel: item.subLabel,
        totalSeconds: item.seconds,
        hours: Number((item.seconds / 3600).toFixed(1)),
        sessionCount: item.count,
      }));
    }

    const minYear = sessionYears[0];
    const maxYear = sessionYears[sessionYears.length - 1];
    const yearStats: { year: number; seconds: number; count: number }[] = [];
    for (let y = minYear; y <= maxYear; y++) {
      yearStats.push({
        year: y,
        seconds: 0,
        count: 0,
      });
    }

    filteredSessions.forEach((s) => {
      const y = new Date(s.completedAt).getFullYear();
      const target = yearStats.find((item) => item.year === y);
      if (target) {
        target.seconds += s.durationSeconds > 0 ? s.durationSeconds : 0;
        target.count += 1;
      }
    });

    return yearStats.map((item) => ({
      key: `year-${item.year}`,
      label: `${item.year}`,
      totalSeconds: item.seconds,
      hours: Number((item.seconds / 3600).toFixed(1)),
      sessionCount: item.count,
    }));
  }

  // 'custom' date range: Exact UTC day count to eliminate DST offsets
  const [sY, sM, sD] = sanitizedCustomRange.start.split('-').map(Number);
  const [eY, eM, eD] = sanitizedCustomRange.end.split('-').map(Number);
  const sUtc = Date.UTC(sY, sM - 1, sD);
  const eUtc = Date.UTC(eY, eM - 1, eD);
  const dayDiff = Math.max(1, Math.round((eUtc - sUtc) / 86400000) + 1);

  const dayList = Array.from({ length: dayDiff }, (_, i) => {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    return {
      date: d,
      dateKey: toDateKey(d),
      dayNum: d.getDate(),
      monthShort: MONTH_NAMES[d.getMonth()].slice(0, 3),
      seconds: 0,
      count: 0,
    };
  });

  filteredSessions.forEach((s) => {
    const key = toDateKey(s.completedAt);
    const target = dayList.find((d) => d.dateKey === key);
    if (target) {
      target.seconds += s.durationSeconds > 0 ? s.durationSeconds : 0;
      target.count += 1;
    }
  });

  return dayList.map((item) => ({
    key: item.dateKey,
    label: String(item.dayNum),
    subLabel: item.monthShort,
    totalSeconds: item.seconds,
    hours: Number((item.seconds / 3600).toFixed(1)),
    sessionCount: item.count,
  }));
}

/**
 * Computes the peak productivity metric for the selected time window.
 */
export function computeProductiveMetric(
  filteredSessions: StatSession[],
  activityBars: ActivityBarStat[],
  periodType: TimePeriodType,
  referenceDate: Date,
  isCurrentPeriod: boolean
): ProductiveMetric {
  if (filteredSessions.length === 0) {
    return {
      title: 'Peak Productivity',
      value: 'N/A',
      subtext: 'No sessions recorded for this selected time window.',
      hasData: false,
    };
  }

  if (periodType === 'day') {
    const hourCounts = new Array(24).fill(0);
    filteredSessions.forEach((s) => {
      const h = new Date(s.completedAt).getHours();
      hourCounts[h] = Math.min(
        3600,
        hourCounts[h] + (s.durationSeconds > 0 ? s.durationSeconds : 0)
      );
    });
    let maxH = 0;
    let maxSec = -1;
    hourCounts.forEach((sec, h) => {
      if (sec > maxSec) {
        maxSec = sec;
        maxH = h;
      }
    });
    const clampedSec = Math.min(3600, Math.max(0, maxSec));
    const nextH = (maxH + 1) % 24;
    return {
      title: 'Peak Focus Hour',
      value:
        maxSec > 0
          ? `${maxH.toString().padStart(2, '0')}:00 – ${nextH.toString().padStart(2, '0')}:00`
          : 'N/A',
      subtext: maxSec > 0 ? `${formatDurationHoursMins(clampedSec)} focused` : 'No sessions logged',
      hasData: maxSec > 0,
    };
  }

  if (periodType === 'all') {
    // All Time: Day of week with highest average focus time
    const weekdaySecs = new Array(7).fill(0);
    const weekdayDateSets: Set<string>[] = Array.from({ length: 7 }, () => new Set<string>());
    filteredSessions.forEach((s) => {
      const d = new Date(s.completedAt);
      const dayIdx = d.getDay();
      weekdaySecs[dayIdx] += s.durationSeconds > 0 ? s.durationSeconds : 0;
      weekdayDateSets[dayIdx].add(toDateKey(d));
    });

    let bestWeekday = 1;
    let highestAvgSec = -1;
    for (let i = 0; i < 7; i++) {
      const activeDaysCount = weekdayDateSets[i].size;
      if (activeDaysCount > 0) {
        const avg = weekdaySecs[i] / activeDaysCount;
        if (avg > highestAvgSec) {
          highestAvgSec = avg;
          bestWeekday = i;
        }
      }
    }

    const avgFormatted = formatDurationHoursMins(Math.round(highestAvgSec > 0 ? highestAvgSec : 0));
    return {
      title: 'Most Productive Day',
      value: highestAvgSec > 0 ? `${WEEKDAY_NAMES[bestWeekday]}s` : 'N/A',
      subtext:
        highestAvgSec > 0
          ? `${avgFormatted} average per ${WEEKDAY_NAMES[bestWeekday].slice(0, 3)}`
          : 'No sessions logged',
      hasData: highestAvgSec > 0,
    };
  }

  if (periodType === 'week') {
    let maxSec = -1;
    let bestLabel = 'N/A';
    for (const bar of activityBars) {
      if (bar.totalSeconds > maxSec) {
        maxSec = bar.totalSeconds;
        bestLabel = `${bar.label} ${bar.subLabel || ''}`.trim();
      }
    }
    return {
      title: isCurrentPeriod ? 'Best Day This Week' : 'Most Productive Day',
      value: maxSec > 0 ? bestLabel : 'N/A',
      subtext: maxSec > 0 ? `${formatDurationHoursMins(maxSec)} focused` : 'No sessions logged',
      hasData: maxSec > 0,
    };
  }

  if (periodType === 'month') {
    let maxSec = -1;
    let bestDay = -1;
    for (const bar of activityBars) {
      if (bar.totalSeconds > maxSec) {
        maxSec = bar.totalSeconds;
        bestDay = Number(bar.label);
      }
    }
    const monthShort = MONTH_NAMES[referenceDate.getMonth()].slice(0, 3);
    return {
      title: 'Most Productive Day',
      value: maxSec > 0 ? `${bestDay} ${monthShort}` : 'N/A',
      subtext: maxSec > 0 ? `${formatDurationHoursMins(maxSec)} focused` : 'No sessions logged',
      hasData: maxSec > 0,
    };
  }

  if (periodType === 'year') {
    let maxSec = -1;
    let bestMonthIdx = -1;
    for (let i = 0; i < activityBars.length; i++) {
      if (activityBars[i].totalSeconds > maxSec) {
        maxSec = activityBars[i].totalSeconds;
        bestMonthIdx = i;
      }
    }
    return {
      title: 'Most Productive Month',
      value: maxSec > 0 && bestMonthIdx >= 0 ? MONTH_NAMES[bestMonthIdx] : 'N/A',
      subtext: maxSec > 0 ? `${formatDurationHoursMins(maxSec)} focused` : 'No sessions logged',
      hasData: maxSec > 0,
    };
  }

  // Custom: Most productive interval
  let maxSec = -1;
  let bestLabel = 'N/A';
  for (const bar of activityBars) {
    if (bar.totalSeconds > maxSec) {
      maxSec = bar.totalSeconds;
      bestLabel = `${bar.label} ${bar.subLabel || ''}`.trim();
    }
  }
  return {
    title: 'Most Productive Day',
    value: maxSec > 0 ? bestLabel : 'N/A',
    subtext: maxSec > 0 ? `${formatDurationHoursMins(maxSec)} focused` : 'No sessions logged',
    hasData: maxSec > 0,
  };
}

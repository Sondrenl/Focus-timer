import { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  toDateKey,
  WEEKDAY_NAMES,
  MONTH_NAMES,
  getDayRange,
  getWeekRange,
  getMonthRange,
  getYearRange,
  formatFriendlyDate,
} from '../utils/dates';

export type TimePeriodType = 'day' | 'week' | 'month' | 'year' | 'custom' | 'all';

export interface TagStat {
  tagId: string;
  name: string;
  color: string;
  isArchived: boolean;
  totalSeconds: number;
  hours: number;
  percentage: number;
  sessionCount: number;
}

export interface ActivityBarStat {
  key: string;
  label: string;
  subLabel?: string;
  totalSeconds: number;
  hours: number;
  sessionCount: number;
}

export interface ProductiveMetric {
  title: string;
  value: string;
  subtext: string;
  hasData: boolean;
}

export function useStatistics() {
  const { sessions, tags } = useApp();

  const [periodType, setPeriodType] = useState<TimePeriodType>('week');
  const [referenceDate, setReferenceDate] = useState<Date>(() => new Date());

  // Default custom range: last 14 days up to today
  const [customRange, setCustomRange] = useState<{ start: string; end: string }>(() => {
    const today = new Date();
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(today.getDate() - 13);
    return {
      start: toDateKey(twoWeeksAgo),
      end: toDateKey(today),
    };
  });

  // Navigation handlers
  const goToPrev = () => {
    const next = new Date(referenceDate);
    if (periodType === 'day') {
      next.setDate(next.getDate() - 1);
    } else if (periodType === 'week') {
      next.setDate(next.getDate() - 7);
    } else if (periodType === 'month') {
      next.setMonth(next.getMonth() - 1);
    } else if (periodType === 'year') {
      next.setFullYear(next.getFullYear() - 1);
    } else if (periodType === 'custom') {
      const startDate = new Date(customRange.start);
      const endDate = new Date(customRange.end);
      const diffMs = endDate.getTime() - startDate.getTime();
      const newStart = new Date(startDate.getTime() - diffMs - 24 * 60 * 60 * 1000);
      const newEnd = new Date(startDate.getTime() - 24 * 60 * 60 * 1000);
      setCustomRange({ start: toDateKey(newStart), end: toDateKey(newEnd) });
      return;
    }
    setReferenceDate(next);
  };

  const goToNext = () => {
    const next = new Date(referenceDate);
    if (periodType === 'day') {
      next.setDate(next.getDate() + 1);
    } else if (periodType === 'week') {
      next.setDate(next.getDate() + 7);
    } else if (periodType === 'month') {
      next.setMonth(next.getMonth() + 1);
    } else if (periodType === 'year') {
      next.setFullYear(next.getFullYear() + 1);
    } else if (periodType === 'custom') {
      const startDate = new Date(customRange.start);
      const endDate = new Date(customRange.end);
      const diffMs = endDate.getTime() - startDate.getTime();
      const newStart = new Date(endDate.getTime() + 24 * 60 * 60 * 1000);
      const newEnd = new Date(endDate.getTime() + diffMs + 24 * 60 * 60 * 1000);
      setCustomRange({ start: toDateKey(newStart), end: toDateKey(newEnd) });
      return;
    }
    setReferenceDate(next);
  };

  const goToToday = () => {
    setReferenceDate(new Date());
    const today = new Date();
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(today.getDate() - 13);
    setCustomRange({
      start: toDateKey(twoWeeksAgo),
      end: toDateKey(today),
    });
  };

  const computedStats = useMemo(() => {
    // Determine effective start and end Date for the period
    let startDate: Date;
    let endDate: Date;
    let periodLabel: string;

    if (periodType === 'day') {
      const range = getDayRange(referenceDate);
      startDate = range.start;
      endDate = range.end;
      periodLabel = referenceDate.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } else if (periodType === 'week') {
      const range = getWeekRange(referenceDate);
      startDate = range.start;
      endDate = range.end;
      const startStr = range.start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const endStr = range.end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      periodLabel = `${startStr} – ${endStr}`;
    } else if (periodType === 'month') {
      const range = getMonthRange(referenceDate);
      startDate = range.start;
      endDate = range.end;
      periodLabel = `${MONTH_NAMES[referenceDate.getMonth()]} ${referenceDate.getFullYear()}`;
    } else if (periodType === 'year') {
      const range = getYearRange(referenceDate);
      startDate = range.start;
      endDate = range.end;
      periodLabel = `${referenceDate.getFullYear()}`;
    } else if (periodType === 'custom') {
      const s = new Date(customRange.start);
      s.setHours(0, 0, 0, 0);
      const e = new Date(customRange.end);
      e.setHours(23, 59, 59, 999);
      startDate = s;
      endDate = e;
      periodLabel = `${formatFriendlyDate(customRange.start)} – ${formatFriendlyDate(customRange.end)}`;
    } else {
      // 'all' time
      startDate = new Date(0);
      endDate = new Date(8640000000000000);
      periodLabel = 'All Time History (Archived Included)';
    }

    const startMs = startDate.getTime();
    const endMs = endDate.getTime();

    // Filter focus WORK sessions within period bounds
    const filteredSessions = sessions.filter((s) => {
      if (s.sessionType !== 'WORK') return false;
      const t = new Date(s.completedAt).getTime();
      return t >= startMs && t <= endMs;
    });

    // 1. High-level aggregates for period
    const totalFocusSeconds = filteredSessions.reduce((acc, s) => acc + s.durationSeconds, 0);
    const totalFocusHours = Number((totalFocusSeconds / 3600).toFixed(1));
    const totalWorkCount = filteredSessions.length;

    // Tag Map
    const tagMap = new Map<string, { name: string; color: string; isArchived: boolean }>();
    tags.forEach((t) => {
      tagMap.set(t.id, { name: t.name, color: t.color, isArchived: t.isArchived });
    });

    // 2. Per-Tag Distribution
    const tagSecondsMap = new Map<string, { seconds: number; count: number }>();
    filteredSessions.forEach((s) => {
      const tagId = s.tagId || 'untagged';
      const curr = tagSecondsMap.get(tagId) || { seconds: 0, count: 0 };
      tagSecondsMap.set(tagId, {
        seconds: curr.seconds + s.durationSeconds,
        count: curr.count + 1,
      });
    });

    // If 'all' period is selected, make sure any archived tag that had sessions is explicitly present
    const tagDistribution: TagStat[] = Array.from(tagSecondsMap.entries()).map(([tagId, data]) => {
      let name = 'Unspecified';
      let color = '#8C8690';
      let isArchived = false;

      if (tagId !== 'untagged' && tagMap.has(tagId)) {
        const info = tagMap.get(tagId)!;
        name = info.name;
        color = info.color;
        isArchived = info.isArchived;
      }

      const hours = Number((data.seconds / 3600).toFixed(1));
      const percentage = totalFocusSeconds > 0 ? Math.round((data.seconds / totalFocusSeconds) * 100) : 0;

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
    });

    tagDistribution.sort((a, b) => b.totalSeconds - a.totalSeconds);

    // 3. Activity breakdown visualization based on periodType
    let activityBars: ActivityBarStat[] = [];

    if (periodType === 'day') {
      // 6 time blocks: 00-04, 04-08, 08-12, 12-16, 16-20, 20-24
      const timeSlots = [
        { label: '00-04h', sub: 'Night', startH: 0, endH: 4 },
        { label: '04-08h', sub: 'Dawn', startH: 4, endH: 8 },
        { label: '08-12h', sub: 'Morning', startH: 8, endH: 12 },
        { label: '12-16h', sub: 'Afternoon', startH: 12, endH: 16 },
        { label: '16-20h', sub: 'Evening', startH: 16, endH: 20 },
        { label: '20-24h', sub: 'Night', startH: 20, endH: 24 },
      ];

      activityBars = timeSlots.map((slot) => {
        let sec = 0;
        let count = 0;
        filteredSessions.forEach((s) => {
          const d = new Date(s.completedAt);
          const h = d.getHours();
          if (h >= slot.startH && h < slot.endH) {
            sec += s.durationSeconds;
            count += 1;
          }
        });
        return {
          key: slot.label,
          label: slot.label,
          subLabel: slot.sub,
          totalSeconds: sec,
          hours: Number((sec / 3600).toFixed(1)),
          sessionCount: count,
        };
      });
    } else if (periodType === 'week') {
      // 7 days of the week from Monday to Sunday
      const weekStart = getWeekRange(referenceDate).start;
      const days = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sun indices

      activityBars = days.map((dayIdx, offset) => {
        const d = new Date(weekStart);
        d.setDate(weekStart.getDate() + offset);
        const dateKey = toDateKey(d);

        let sec = 0;
        let count = 0;
        filteredSessions.forEach((s) => {
          if (toDateKey(s.completedAt) === dateKey) {
            sec += s.durationSeconds;
            count += 1;
          }
        });

        return {
          key: dateKey,
          label: WEEKDAY_NAMES[dayIdx].substring(0, 3),
          subLabel: `${d.getDate()}/${d.getMonth() + 1}`,
          totalSeconds: sec,
          hours: Number((sec / 3600).toFixed(1)),
          sessionCount: count,
        };
      });
    } else if (periodType === 'month') {
      // Group by weeks or 5-day intervals across the month
      const totalDays = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0).getDate();
      const intervals = Math.ceil(totalDays / 5);

      activityBars = Array.from({ length: intervals }, (_, i) => {
        const startDay = i * 5 + 1;
        const endDay = Math.min(totalDays, (i + 1) * 5);
        let sec = 0;
        let count = 0;

        filteredSessions.forEach((s) => {
          const d = new Date(s.completedAt);
          const dayNum = d.getDate();
          if (dayNum >= startDay && dayNum <= endDay) {
            sec += s.durationSeconds;
            count += 1;
          }
        });

        return {
          key: `m-part-${i}`,
          label: `${startDay}-${endDay}`,
          subLabel: MONTH_NAMES[referenceDate.getMonth()].substring(0, 3),
          totalSeconds: sec,
          hours: Number((sec / 3600).toFixed(1)),
          sessionCount: count,
        };
      });
    } else if (periodType === 'year') {
      // 12 months (Jan..Dec)
      activityBars = MONTH_NAMES.map((mName, mIdx) => {
        let sec = 0;
        let count = 0;
        filteredSessions.forEach((s) => {
          const d = new Date(s.completedAt);
          if (d.getMonth() === mIdx) {
            sec += s.durationSeconds;
            count += 1;
          }
        });
        return {
          key: mName,
          label: mName.substring(0, 3),
          totalSeconds: sec,
          hours: Number((sec / 3600).toFixed(1)),
          sessionCount: count,
        };
      });
    } else if (periodType === 'all') {
      // Group by months in history
      const monthMap = new Map<string, { seconds: number; count: number }>();
      filteredSessions.forEach((s) => {
        const d = new Date(s.completedAt);
        const key = `${MONTH_NAMES[d.getMonth()].substring(0, 3)} '${d.getFullYear().toString().substring(2)}`;
        const curr = monthMap.get(key) || { seconds: 0, count: 0 };
        monthMap.set(key, { seconds: curr.seconds + s.durationSeconds, count: curr.count + 1 });
      });

      if (monthMap.size === 0) {
        activityBars = [];
      } else {
        activityBars = Array.from(monthMap.entries()).map(([key, data]) => ({
          key,
          label: key,
          totalSeconds: data.seconds,
          hours: Number((data.seconds / 3600).toFixed(1)),
          sessionCount: data.count,
        }));
      }
    } else {
      // 'custom': Group by calendar dates within custom range
      const sDate = new Date(customRange.start);
      const eDate = new Date(customRange.end);
      const dayDiff = Math.max(1, Math.round((eDate.getTime() - sDate.getTime()) / (24 * 60 * 60 * 1000)));

      // If range is under 14 days, show each day; otherwise show chunks
      if (dayDiff <= 14) {
        activityBars = Array.from({ length: dayDiff + 1 }, (_, i) => {
          const d = new Date(sDate);
          d.setDate(sDate.getDate() + i);
          const dateKey = toDateKey(d);

          let sec = 0;
          let count = 0;
          filteredSessions.forEach((s) => {
            if (toDateKey(s.completedAt) === dateKey) {
              sec += s.durationSeconds;
              count += 1;
            }
          });

          return {
            key: dateKey,
            label: `${d.getDate()}/${d.getMonth() + 1}`,
            subLabel: WEEKDAY_NAMES[d.getDay()].substring(0, 3),
            totalSeconds: sec,
            hours: Number((sec / 3600).toFixed(1)),
            sessionCount: count,
          };
        });
      } else {
        const step = Math.ceil(dayDiff / 6);
        activityBars = Array.from({ length: 6 }, (_, i) => {
          const chunkStart = new Date(sDate);
          chunkStart.setDate(sDate.getDate() + i * step);
          const chunkEnd = new Date(sDate);
          chunkEnd.setDate(Math.min(eDate.getDate(), sDate.getDate() + (i + 1) * step - 1));

          let sec = 0;
          let count = 0;
          filteredSessions.forEach((s) => {
            const d = new Date(s.completedAt);
            if (d >= chunkStart && d <= chunkEnd) {
              sec += s.durationSeconds;
              count += 1;
            }
          });

          return {
            key: `chunk-${i}`,
            label: `${chunkStart.getDate()}/${chunkStart.getMonth() + 1}`,
            subLabel: `to ${chunkEnd.getDate()}/${chunkEnd.getMonth() + 1}`,
            totalSeconds: sec,
            hours: Number((sec / 3600).toFixed(1)),
            sessionCount: count,
          };
        });
      }
    }

    // 4. Productivity Metric for this specific period
    let productiveMetric: ProductiveMetric;
    if (filteredSessions.length === 0) {
      productiveMetric = {
        title: 'Peak Productivity',
        value: 'N/A',
        subtext: 'No sessions recorded for this selected time window.',
        hasData: false,
      };
    } else if (periodType === 'day') {
      const hourCounts = new Array(24).fill(0);
      filteredSessions.forEach((s) => {
        const h = new Date(s.completedAt).getHours();
        hourCounts[h] += s.durationSeconds;
      });
      let maxH = 0;
      let maxSec = -1;
      hourCounts.forEach((sec, h) => {
        if (sec > maxSec) {
          maxSec = sec;
          maxH = h;
        }
      });
      productiveMetric = {
        title: 'Peak Focus Hour',
        value: `${maxH.toString().padStart(2, '0')}:00 – ${(maxH + 1).toString().padStart(2, '0')}:00`,
        subtext: `${(maxSec / 3600).toFixed(1)} hrs completed in this hour window`,
        hasData: true,
      };
    } else {
      const weekdaySecs = new Array(7).fill(0);
      const weekdayCounts = new Array(7).fill(0);
      filteredSessions.forEach((s) => {
        const d = new Date(s.completedAt).getDay();
        weekdaySecs[d] += s.durationSeconds;
        weekdayCounts[d] += 1;
      });
      let maxDay = 1;
      let maxSec = -1;
      weekdaySecs.forEach((sec, idx) => {
        if (sec > maxSec) {
          maxSec = sec;
          maxDay = idx;
        }
      });
      productiveMetric = {
        title: 'Most Productive Day',
        value: WEEKDAY_NAMES[maxDay],
        subtext: `${(maxSec / 3600).toFixed(1)} hrs across ${weekdayCounts[maxDay]} sessions`,
        hasData: true,
      };
    }

    return {
      periodLabel,
      totalFocusSeconds,
      totalFocusHours,
      totalWorkCount,
      tagDistribution,
      activityBars,
      productiveMetric,
    };
  }, [sessions, tags, periodType, referenceDate, customRange]);

  return {
    periodType,
    setPeriodType,
    referenceDate,
    customRange,
    setCustomRange,
    goToPrev,
    goToNext,
    goToToday,
    ...computedStats,
  };
}

import { isProduction } from "../utils/environment";
import { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { Tag } from '../types/tag';
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
import { formatDurationHoursMins } from '../utils/formatters';

export type TimePeriodType = 'day' | 'week' | 'month' | 'year' | 'all' | 'custom';

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
  const { sessions, tags, coffeeCups } = useApp();

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
    setReferenceDate((prev) => {
      const d = new Date(prev);
      if (periodType === 'day') d.setDate(d.getDate() - 1);
      else if (periodType === 'week') d.setDate(d.getDate() - 7);
      else if (periodType === 'month') d.setMonth(d.getMonth() - 1);
      else if (periodType === 'year') d.setFullYear(d.getFullYear() - 1);
      return d;
    });
  };

  const goToNext = () => {
    setReferenceDate((prev) => {
      const d = new Date(prev);
      if (periodType === 'day') d.setDate(d.getDate() + 1);
      else if (periodType === 'week') d.setDate(d.getDate() + 7);
      else if (periodType === 'month') d.setMonth(d.getMonth() + 1);
      else if (periodType === 'year') d.setFullYear(d.getFullYear() + 1);
      return d;
    });
  };

  const goToToday = () => {
    setReferenceDate(new Date());
  };

  // Main statistics derivation
  const stats = useMemo(() => {
    let startDate: Date;
    let endDate: Date;
    let periodLabel = '';

    const ref = referenceDate;

    if (periodType === 'day') {
      const r = getDayRange(ref);
      startDate = r.start;
      endDate = r.end;
      periodLabel = formatFriendlyDate(ref);
    } else if (periodType === 'week') {
      const r = getWeekRange(ref);
      startDate = r.start;
      endDate = r.end;
      const sStr = `${startDate.getDate()} ${MONTH_NAMES[startDate.getMonth()].slice(0, 3)}`;
      const eStr = `${endDate.getDate()} ${MONTH_NAMES[endDate.getMonth()].slice(0, 3)} ${endDate.getFullYear()}`;
      periodLabel = `${sStr} – ${eStr}`;
    } else if (periodType === 'month') {
      const r = getMonthRange(ref);
      startDate = r.start;
      endDate = r.end;
      periodLabel = `${MONTH_NAMES[startDate.getMonth()]} ${startDate.getFullYear()}`;
    } else if (periodType === 'year') {
      const r = getYearRange(ref);
      startDate = r.start;
      endDate = r.end;
      periodLabel = `${startDate.getFullYear()}`;
    } else if (periodType === 'custom') {
      const s = new Date(`${customRange.start}T00:00:00.000`);
      const e = new Date(`${customRange.end}T23:59:59.999`);
      startDate = s;
      endDate = e;
      periodLabel = `${formatFriendlyDate(s, true)} – ${formatFriendlyDate(e, true)}`;
    } else {
      // 'all' time
      startDate = new Date(0);
      endDate = new Date(Date.now() + 86400000 * 365);
      periodLabel = 'All Time History';
    }

    // Filter work sessions within period
    const filteredSessions = sessions.filter((s) => {
      if (s.sessionType !== 'WORK') return false;
      if (isProduction() && (s.id.startsWith('seed-session-') || s.id.startsWith('sample-session-'))) return false;
      const d = new Date(s.completedAt);
      return d >= startDate && d <= endDate;
    });

    // 1. Total Metrics
    const totalFocusSeconds = filteredSessions.reduce((acc, s) => acc + s.durationSeconds, 0);
    const totalFocusHours = Number((totalFocusSeconds / 3600).toFixed(1));
    const totalWorkCount = filteredSessions.length;

    // 2. Tag Distribution
    const tagMap = new Map<string, Tag>();
    tags.forEach((t) => tagMap.set(t.id, t));

    const tagSecondsMap = new Map<string, { seconds: number; count: number }>();
    filteredSessions.forEach((s) => {
      const tagId = s.tagId || 'unassigned';
      const curr = tagSecondsMap.get(tagId) || { seconds: 0, count: 0 };
      curr.seconds += s.durationSeconds;
      curr.count += 1;
      tagSecondsMap.set(tagId, curr);
    });

    const tagDistribution: TagStat[] = Array.from(tagSecondsMap.entries())
      .map(([tagId, data]) => {
        const foundTag = tagMap.get(tagId);
        const name = tagId === 'unassigned' ? 'Unassigned' : foundTag ? foundTag.name : 'Unknown Tag';
        const color = tagId === 'unassigned' ? '#9E9E9E' : foundTag ? foundTag.color : '#BDBDBD';
        const isArchived = foundTag ? foundTag.isArchived : false;
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
      })
      .sort((a, b) => b.totalSeconds - a.totalSeconds);

    // 3. Activity Breakdown for Bar Chart
    let activityBars: ActivityBarStat[] = [];

    if (periodType === 'day') {
      if (filteredSessions.length === 0) {
        activityBars = [];
      } else {
        // Leftmost column: hour when first session was completed. Rightmost: latest hour.
        const sessionHours = filteredSessions.map((s) => new Date(s.completedAt).getHours());
        const minHour = Math.min(...sessionHours);
        const maxHour = Math.max(...sessionHours);

        const hoursCount = maxHour - minHour + 1;
        const hoursArray = Array.from({ length: hoursCount }, (_, i) => {
          const hour = minHour + i;
          return {
            hour,
            seconds: 0,
            count: 0,
          };
        });

        filteredSessions.forEach((s) => {
          const d = new Date(s.completedAt);
          const h = d.getHours();
          const target = hoursArray.find((item) => item.hour === h);
          if (target) {
            target.seconds += s.durationSeconds;
            target.count += 1;
          }
        });

        activityBars = hoursArray.map((item) => ({
          key: `hour-${item.hour}`,
          label: `${item.hour.toString().padStart(2, '0')}:00`,
          totalSeconds: item.seconds,
          hours: Number((item.seconds / 3600).toFixed(1)),
          sessionCount: item.count,
        }));
      }
    } else if (periodType === 'week') {
      const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(startDate);
        d.setDate(d.getDate() + i);
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
          target.seconds += s.durationSeconds;
          target.count += 1;
        }
      });

      activityBars = days.map((item) => ({
        key: item.dateKey,
        label: item.label,
        subLabel: `${item.date.getDate()}`,
        totalSeconds: item.seconds,
        hours: Number((item.seconds / 3600).toFixed(1)),
        sessionCount: item.count,
      }));
    } else if (periodType === 'month') {
      const daysInMonth = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate();
      const monthDays = Array.from({ length: daysInMonth }, (_, i) => {
        const d = new Date(ref.getFullYear(), ref.getMonth(), i + 1);
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
          target.seconds += s.durationSeconds;
          target.count += 1;
        }
      });

      activityBars = monthDays.map((item) => ({
        key: item.dateKey,
        label: `${item.dayNum}`,
        totalSeconds: item.seconds,
        hours: Number((item.seconds / 3600).toFixed(1)),
        sessionCount: item.count,
      }));
    } else if (periodType === 'year') {
      const months = Array.from({ length: 12 }, (_, i) => ({
        monthIdx: i,
        label: MONTH_NAMES[i].slice(0, 3),
        seconds: 0,
        count: 0,
      }));

      filteredSessions.forEach((s) => {
        const m = new Date(s.completedAt).getMonth();
        months[m].seconds += s.durationSeconds;
        months[m].count += 1;
      });

      activityBars = months.map((item) => ({
        key: `month-${item.monthIdx}`,
        label: item.label,
        totalSeconds: item.seconds,
        hours: Number((item.seconds / 3600).toFixed(1)),
        sessionCount: item.count,
      }));
    } else if (periodType === 'all') {
      if (filteredSessions.length === 0) {
        activityBars = [];
      } else {
        const sessionYears = Array.from(
          new Set(filteredSessions.map((s) => new Date(s.completedAt).getFullYear()))
        ).sort();

        if (sessionYears.length <= 1) {
          // Within a single year: breakdown by all 12 months with the year specified
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
            months[m].seconds += s.durationSeconds;
            months[m].count += 1;
          });

          activityBars = months.map((item) => ({
            key: `all-month-${item.monthIdx}`,
            label: item.label,
            subLabel: item.subLabel,
            totalSeconds: item.seconds,
            hours: Number((item.seconds / 3600).toFixed(1)),
            sessionCount: item.count,
          }));
        } else {
          // Multi-year history: breakdown by each year
          const minYear = Math.min(...sessionYears);
          const maxYear = Math.max(...sessionYears);
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
              target.seconds += s.durationSeconds;
              target.count += 1;
            }
          });

          activityBars = yearStats.map((item) => ({
            key: `year-${item.year}`,
            label: `${item.year}`,
            totalSeconds: item.seconds,
            hours: Number((item.seconds / 3600).toFixed(1)),
            sessionCount: item.count,
          }));
        }
      }
    } else {
      // 'custom' date range
      const sDate = new Date(`${customRange.start}T00:00:00.000`);
      const eDate = new Date(`${customRange.end}T23:59:59.999`);
      const dayDiff = Math.max(1, Math.round((eDate.getTime() - sDate.getTime()) / (1000 * 60 * 60 * 24)));

      if (dayDiff <= 14) {
        const dayList = Array.from({ length: dayDiff }, (_, i) => {
          const d = new Date(sDate.getTime() + i * 86400000);
          return {
            dateKey: toDateKey(d),
            label: `${d.getDate()}/${d.getMonth() + 1}`,
            seconds: 0,
            count: 0,
          };
        });

        filteredSessions.forEach((s) => {
          const key = toDateKey(s.completedAt);
          const target = dayList.find((d) => d.dateKey === key);
          if (target) {
            target.seconds += s.durationSeconds;
            target.count += 1;
          }
        });

        activityBars = dayList.map((item) => ({
          key: item.dateKey,
          label: item.label,
          totalSeconds: item.seconds,
          hours: Number((item.seconds / 3600).toFixed(1)),
          sessionCount: item.count,
        }));
      } else {
        const stepDays = Math.ceil(dayDiff / 6);
        activityBars = Array.from({ length: 6 }, (_, i) => {
          const chunkStart = new Date(sDate.getTime() + i * stepDays * 86400000);
          const chunkEnd = new Date(Math.min(eDate.getTime(), sDate.getTime() + ((i + 1) * stepDays - 1) * 86400000));

          let sec = 0;
          let count = 0;
          filteredSessions.forEach((s) => {
            const t = new Date(s.completedAt).getTime();
            if (t >= chunkStart.getTime() && t <= chunkEnd.getTime()) {
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
        hourCounts[h] = Math.min(3600, hourCounts[h] + s.durationSeconds);
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
      productiveMetric = {
        title: 'Peak Focus Hour',
        value: `${maxH.toString().padStart(2, '0')}:00 – ${(maxH + 1).toString().padStart(2, '0')}:00`,
        subtext: `${formatDurationHoursMins(clampedSec)} focused`,
        hasData: maxSec > 0,
      };
    } else if (periodType === 'all') {
      // All Time: Day of week with highest average focus time
      const weekdaySecs = new Array(7).fill(0);
      const weekdayDateSets: Set<string>[] = Array.from({ length: 7 }, () => new Set<string>());
      filteredSessions.forEach((s) => {
        const d = new Date(s.completedAt);
        const dayIdx = d.getDay();
        weekdaySecs[dayIdx] += s.durationSeconds;
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
      productiveMetric = {
        title: 'Most Productive Day',
        value: `${WEEKDAY_NAMES[bestWeekday]}s`,
        subtext: `${avgFormatted} average per ${WEEKDAY_NAMES[bestWeekday].slice(0, 3)}`,
        hasData: highestAvgSec > 0,
      };
    } else if (periodType === 'week') {
      // Single week: Specific weekday within the week
      let maxSec = -1;
      let bestLabel = 'N/A';
      for (const bar of activityBars) {
        if (bar.totalSeconds > maxSec) {
          maxSec = bar.totalSeconds;
          bestLabel = `${bar.label} ${bar.subLabel || ''}`.trim();
        }
      }
      productiveMetric = {
        title: 'Best Day This Week',
        value: maxSec > 0 ? bestLabel : 'N/A',
        subtext: maxSec > 0 ? `${formatDurationHoursMins(maxSec)} focused` : 'No sessions logged',
        hasData: maxSec > 0,
      };
    } else {
      // Month, Year, Custom: Most productive interval
      let maxSec = -1;
      let bestLabel = 'N/A';
      for (const bar of activityBars) {
        if (bar.totalSeconds > maxSec) {
          maxSec = bar.totalSeconds;
          bestLabel = `${bar.label} ${bar.subLabel || ''}`.trim();
        }
      }
      productiveMetric = {
        title: 'Most Productive Period',
        value: maxSec > 0 ? bestLabel : 'N/A',
        subtext: maxSec > 0 ? `${formatDurationHoursMins(maxSec)} focused` : 'No sessions logged',
        hasData: maxSec > 0,
      };
    }

    // Filter coffee cups within period
    const startKey = toDateKey(startDate);
    const endKey = toDateKey(endDate);
    const filteredCoffee = coffeeCups.filter((cup) => {
      return cup.date >= startKey && cup.date <= endKey;
    });
    const totalCoffeeCups = filteredCoffee.length;

    return {
      periodLabel,
      totalFocusSeconds,
      totalFocusHours,
      totalWorkCount,
      totalCoffeeCups,
      tagDistribution,
      activityBars,
      productiveMetric,
    };
  }, [sessions, tags, coffeeCups, periodType, referenceDate, customRange]);

  return {
    periodType,
    setPeriodType,
    periodLabel: stats.periodLabel,
    customRange,
    setCustomRange,
    goToPrev,
    goToNext,
    goToToday,
    totalFocusSeconds: stats.totalFocusSeconds,
    totalFocusHours: stats.totalFocusHours,
    totalWorkCount: stats.totalWorkCount,
    totalCoffeeCups: stats.totalCoffeeCups,
    tagDistribution: stats.tagDistribution,
    activityBars: stats.activityBars,
    productiveMetric: stats.productiveMetric,
  };
}

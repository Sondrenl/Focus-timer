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

export interface CoffeePeakMetric {
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

  const now = new Date();
  const todayKey = toDateKey(now);

  // Navigation handlers with month-end and leap-year overflow protection
  const goToPrev = () => {
    setReferenceDate((prev) => {
      const d = new Date(prev);
      if (periodType === 'day') {
        d.setDate(d.getDate() - 1);
      } else if (periodType === 'week') {
        d.setDate(d.getDate() - 7);
      } else if (periodType === 'month') {
        // Setting day to 1 prevents 31st overflow (e.g. March 31 -> Feb 31 -> March 3)
        const targetMonth = d.getMonth() - 1;
        d.setDate(1);
        d.setMonth(targetMonth);
      } else if (periodType === 'year') {
        // Setting day to 1 prevents leap-year Feb 29 overflow
        const targetYear = d.getFullYear() - 1;
        d.setDate(1);
        d.setFullYear(targetYear);
      }
      return d;
    });
  };

  const goToNext = () => {
    setReferenceDate((prev) => {
      const d = new Date(prev);
      if (periodType === 'day') {
        d.setDate(d.getDate() + 1);
      } else if (periodType === 'week') {
        d.setDate(d.getDate() + 7);
      } else if (periodType === 'month') {
        // Setting day to 1 prevents end-of-month overflow (e.g. Jan 31 -> Feb 31 -> March 3)
        const targetMonth = d.getMonth() + 1;
        d.setDate(1);
        d.setMonth(targetMonth);
      } else if (periodType === 'year') {
        const targetYear = d.getFullYear() + 1;
        d.setDate(1);
        d.setFullYear(targetYear);
      }
      return d;
    });
  };

  const goToToday = () => {
    setReferenceDate(new Date());
  };

  // Determine if viewing current period
  const isCurrentPeriod = useMemo(() => {
    if (periodType === 'day') {
      return toDateKey(referenceDate) === todayKey;
    }
    if (periodType === 'week') {
      const { start, end } = getWeekRange(referenceDate);
      return todayKey >= toDateKey(start) && todayKey <= toDateKey(end);
    }
    if (periodType === 'month') {
      return (
        referenceDate.getFullYear() === now.getFullYear() &&
        referenceDate.getMonth() === now.getMonth()
      );
    }
    if (periodType === 'year') {
      return referenceDate.getFullYear() === now.getFullYear();
    }
    return true; // 'all' and 'custom' are static / range-driven
  }, [periodType, referenceDate, todayKey]);

  // Determine if forward navigation is permitted (cannot navigate past current period)
  const canGoNext = useMemo(() => {
    if (periodType === 'all' || periodType === 'custom') return false;
    if (periodType === 'day') {
      return toDateKey(referenceDate) < todayKey;
    }
    if (periodType === 'week') {
      const { end } = getWeekRange(referenceDate);
      return toDateKey(end) < todayKey;
    }
    if (periodType === 'month') {
      if (referenceDate.getFullYear() < now.getFullYear()) return true;
      if (referenceDate.getFullYear() === now.getFullYear()) {
        return referenceDate.getMonth() < now.getMonth();
      }
      return false;
    }
    if (periodType === 'year') {
      return referenceDate.getFullYear() < now.getFullYear();
    }
    return false;
  }, [periodType, referenceDate, todayKey]);

  // Main statistics derivation
  const stats = useMemo(() => {
    let startDate: Date;
    let endDate: Date;
    let periodLabel = '';

    const ref = referenceDate;

    // Sanitized custom range bounds
    let sCustomKey = customRange.start;
    let eCustomKey = customRange.end;
    if (sCustomKey > eCustomKey) {
      const tmp = sCustomKey;
      sCustomKey = eCustomKey;
      eCustomKey = tmp;
    }

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
      const s = new Date(`${sCustomKey}T00:00:00.000`);
      const e = new Date(`${eCustomKey}T23:59:59.999`);
      startDate = s;
      endDate = e;
      periodLabel = `${formatFriendlyDate(s, true)} – ${formatFriendlyDate(e, true)}`;
    } else {
      // 'all' time
      startDate = new Date(0);
      endDate = new Date(Date.now() + 86400000 * 365);
      periodLabel = 'All Time History';
    }

    // Filter work sessions within period with robust timestamp validation
    const filteredSessions = sessions.filter((s) => {
      if (s.sessionType !== 'WORK') return false;
      if (isProduction() && (s.id.startsWith('seed-session-') || s.id.startsWith('sample-session-'))) return false;
      if (!s.completedAt) return false;
      const d = new Date(s.completedAt);
      if (isNaN(d.getTime())) return false;
      return d >= startDate && d <= endDate;
    });

    // 1. Total Metrics
    const totalFocusSeconds = filteredSessions.reduce(
      (acc, s) => acc + (s.durationSeconds > 0 ? s.durationSeconds : 0),
      0
    );
    const totalFocusHours = Number((totalFocusSeconds / 3600).toFixed(1));
    const totalWorkCount = filteredSessions.length;

    // 2. Tag Distribution
    const tagMap = new Map<string, Tag>();
    tags.forEach((t) => tagMap.set(t.id, t));

    const tagSecondsMap = new Map<string, { seconds: number; count: number }>();
    filteredSessions.forEach((s) => {
      const tagId = s.tagId || 'unassigned';
      const curr = tagSecondsMap.get(tagId) || { seconds: 0, count: 0 };
      curr.seconds += s.durationSeconds > 0 ? s.durationSeconds : 0;
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
        const sessionHours = filteredSessions.map((s) => new Date(s.completedAt).getHours());
        let minHour = Math.min(...sessionHours);
        let maxHour = Math.max(...sessionHours);

        // If minHour === maxHour (single active hour), pad by 1 hour on each side for clear visual context
        if (minHour === maxHour) {
          minHour = Math.max(0, minHour - 1);
          maxHour = Math.min(23, maxHour + 1);
        }

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
            target.seconds += s.durationSeconds > 0 ? s.durationSeconds : 0;
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
      const monthShort = MONTH_NAMES[ref.getMonth()].slice(0, 3);
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
          target.seconds += s.durationSeconds > 0 ? s.durationSeconds : 0;
          target.count += 1;
        }
      });

      activityBars = monthDays.map((item) => ({
        key: item.dateKey,
        label: `${item.dayNum}`,
        subLabel: monthShort,
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
        if (months[m]) {
          months[m].seconds += s.durationSeconds > 0 ? s.durationSeconds : 0;
          months[m].count += 1;
        }
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

          activityBars = months.map((item) => ({
            key: `all-month-${item.monthIdx}`,
            label: item.label,
            subLabel: item.subLabel,
            totalSeconds: item.seconds,
            hours: Number((item.seconds / 3600).toFixed(1)),
            sessionCount: item.count,
          }));
        } else {
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
      // 'custom' date range: Exact UTC day count to eliminate DST offsets
      const [sY, sM, sD] = sCustomKey.split('-').map(Number);
      const [eY, eM, eD] = eCustomKey.split('-').map(Number);
      const sUtc = Date.UTC(sY, sM - 1, sD);
      const eUtc = Date.UTC(eY, eM - 1, eD);
      const dayDiff = Math.max(1, Math.round((eUtc - sUtc) / 86400000) + 1);

      if (dayDiff <= 14) {
        const dayList = Array.from({ length: dayDiff }, (_, i) => {
          const d = new Date(startDate);
          d.setDate(startDate.getDate() + i);
          return {
            dateKey: toDateKey(d),
            label: `${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0, 3)}`,
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

        activityBars = dayList.map((item) => ({
          key: item.dateKey,
          label: item.label,
          totalSeconds: item.seconds,
          hours: Number((item.seconds / 3600).toFixed(1)),
          sessionCount: item.count,
        }));
      } else {
        // Partition custom range into up to 6 non-overlapping, contiguous chunks
        const numChunks = Math.min(dayDiff, 6);
        activityBars = Array.from({ length: numChunks }, (_, i) => {
          const startDayOffset = Math.round((i * dayDiff) / numChunks);
          const endDayOffset = Math.round(((i + 1) * dayDiff) / numChunks) - 1;

          const chunkStart = new Date(startDate);
          chunkStart.setDate(startDate.getDate() + startDayOffset);
          chunkStart.setHours(0, 0, 0, 0);

          const chunkEnd = new Date(startDate);
          chunkEnd.setDate(startDate.getDate() + endDayOffset);
          chunkEnd.setHours(23, 59, 59, 999);

          let sec = 0;
          let count = 0;
          filteredSessions.forEach((s) => {
            const t = new Date(s.completedAt).getTime();
            if (t >= chunkStart.getTime() && t <= chunkEnd.getTime()) {
              sec += s.durationSeconds > 0 ? s.durationSeconds : 0;
              count += 1;
            }
          });

          const isSingleDay = startDayOffset === endDayOffset;
          const sLabel = `${chunkStart.getDate()} ${MONTH_NAMES[chunkStart.getMonth()].slice(0, 3)}`;
          const eLabel = `${chunkEnd.getDate()} ${MONTH_NAMES[chunkEnd.getMonth()].slice(0, 3)}`;

          return {
            key: `chunk-${i}`,
            label: sLabel,
            subLabel: isSingleDay ? undefined : `to ${eLabel}`,
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
        hourCounts[h] = Math.min(3600, hourCounts[h] + (s.durationSeconds > 0 ? s.durationSeconds : 0));
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
      productiveMetric = {
        title: 'Peak Focus Hour',
        value: maxSec > 0 ? `${maxH.toString().padStart(2, '0')}:00 – ${nextH.toString().padStart(2, '0')}:00` : 'N/A',
        subtext: maxSec > 0 ? `${formatDurationHoursMins(clampedSec)} focused` : 'No sessions logged',
        hasData: maxSec > 0,
      };
    } else if (periodType === 'all') {
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
      productiveMetric = {
        title: 'Most Productive Day',
        value: highestAvgSec > 0 ? `${WEEKDAY_NAMES[bestWeekday]}s` : 'N/A',
        subtext: highestAvgSec > 0 ? `${avgFormatted} average per ${WEEKDAY_NAMES[bestWeekday].slice(0, 3)}` : 'No sessions logged',
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
        title: isCurrentPeriod ? 'Best Day This Week' : 'Most Productive Day',
        value: maxSec > 0 ? bestLabel : 'N/A',
        subtext: maxSec > 0 ? `${formatDurationHoursMins(maxSec)} focused` : 'No sessions logged',
        hasData: maxSec > 0,
      };
    } else if (periodType === 'month') {
      let maxSec = -1;
      let bestDay = -1;
      for (const bar of activityBars) {
        if (bar.totalSeconds > maxSec) {
          maxSec = bar.totalSeconds;
          bestDay = Number(bar.label);
        }
      }
      const monthShort = MONTH_NAMES[ref.getMonth()].slice(0, 3);
      productiveMetric = {
        title: 'Most Productive Day',
        value: maxSec > 0 ? `${bestDay} ${monthShort}` : 'N/A',
        subtext: maxSec > 0 ? `${formatDurationHoursMins(maxSec)} focused` : 'No sessions logged',
        hasData: maxSec > 0,
      };
    } else if (periodType === 'year') {
      let maxSec = -1;
      let bestMonthIdx = -1;
      for (let i = 0; i < activityBars.length; i++) {
        if (activityBars[i].totalSeconds > maxSec) {
          maxSec = activityBars[i].totalSeconds;
          bestMonthIdx = i;
        }
      }
      productiveMetric = {
        title: 'Most Productive Month',
        value: maxSec > 0 && bestMonthIdx >= 0 ? MONTH_NAMES[bestMonthIdx] : 'N/A',
        subtext: maxSec > 0 ? `${formatDurationHoursMins(maxSec)} focused` : 'No sessions logged',
        hasData: maxSec > 0,
      };
    } else {
      // Custom: Most productive interval
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

    // 5. Coffee Calculations
    const startKey = toDateKey(startDate);
    const endKey = toDateKey(endDate);
    const filteredCoffee = coffeeCups.filter((cup) => {
      if (!cup || !cup.date) return false;
      return cup.date >= startKey && cup.date <= endKey;
    });
    const totalCoffeeCups = filteredCoffee.length;

    // Elapsed days calculation using UTC date boundaries to prevent DST offset drift
    let coffeeElapsedDays = 1;

    if (periodType === 'day') {
      coffeeElapsedDays = 1;
    } else if (periodType === 'week') {
      if (todayKey >= startKey && todayKey <= endKey) {
        // Current week: days elapsed from start of week (Monday) to today
        const [sY, sM, sD] = startKey.split('-').map(Number);
        const [tY, tM, tD] = todayKey.split('-').map(Number);
        const diffDays = Math.round((Date.UTC(tY, tM - 1, tD) - Date.UTC(sY, sM - 1, sD)) / 86400000) + 1;
        coffeeElapsedDays = Math.max(1, Math.min(7, diffDays));
      } else if (todayKey > endKey) {
        // Past week: full 7 days elapsed
        coffeeElapsedDays = 7;
      } else {
        // Future week
        coffeeElapsedDays = 1;
      }
    } else if (periodType === 'month') {
      const daysInMonth = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate();
      if (ref.getFullYear() === now.getFullYear() && ref.getMonth() === now.getMonth()) {
        coffeeElapsedDays = Math.max(1, Math.min(daysInMonth, now.getDate()));
      } else if (
        ref.getFullYear() < now.getFullYear() ||
        (ref.getFullYear() === now.getFullYear() && ref.getMonth() < now.getMonth())
      ) {
        coffeeElapsedDays = daysInMonth;
      } else {
        coffeeElapsedDays = 1;
      }
    } else if (periodType === 'year') {
      const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
      const totalDaysInYear = isLeap(ref.getFullYear()) ? 366 : 365;
      if (ref.getFullYear() === now.getFullYear()) {
        const startOfYearUtc = Date.UTC(now.getFullYear(), 0, 1);
        const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
        const dayOfYear = Math.round((todayUtc - startOfYearUtc) / 86400000) + 1;
        coffeeElapsedDays = Math.max(1, Math.min(totalDaysInYear, dayOfYear));
      } else if (ref.getFullYear() < now.getFullYear()) {
        coffeeElapsedDays = totalDaysInYear;
      } else {
        coffeeElapsedDays = 1;
      }
    } else if (periodType === 'custom') {
      const [sY, sM, sD] = sCustomKey.split('-').map(Number);
      const [eY, eM, eD] = eCustomKey.split('-').map(Number);
      const [tY, tM, tD] = todayKey.split('-').map(Number);
      const sUtc = Date.UTC(sY, sM - 1, sD);
      const eUtc = Date.UTC(eY, eM - 1, eD);
      const todayUtc = Date.UTC(tY, tM - 1, tD);

      const effectiveEndUtc = Math.min(eUtc, todayUtc);
      if (effectiveEndUtc >= sUtc) {
        coffeeElapsedDays = Math.max(1, Math.round((effectiveEndUtc - sUtc) / 86400000) + 1);
      } else {
        coffeeElapsedDays = 1;
      }
    } else {
      // 'all' time: days from earliest coffee cup to today
      if (filteredCoffee.length > 0) {
        const sortedDates = filteredCoffee.map((c) => c.date).sort();
        const firstDateStr = sortedDates[0];
        const [fY, fM, fD] = firstDateStr.split('-').map(Number);
        const [tY, tM, tD] = todayKey.split('-').map(Number);
        const firstUtc = Date.UTC(fY, fM - 1, fD);
        const todayUtc = Date.UTC(tY, tM - 1, tD);
        if (todayUtc >= firstUtc) {
          coffeeElapsedDays = Math.max(1, Math.round((todayUtc - firstUtc) / 86400000) + 1);
        } else {
          coffeeElapsedDays = 1;
        }
      } else {
        coffeeElapsedDays = 1;
      }
    }

    const coffeeDailyAverage = Number((totalCoffeeCups / coffeeElapsedDays).toFixed(1));

    // Peak coffee metric calculation
    let coffeePeakMetric: CoffeePeakMetric;

    // Group cups by date within period
    const dayCupCounts = new Map<string, number>();
    filteredCoffee.forEach((c) => {
      dayCupCounts.set(c.date, (dayCupCounts.get(c.date) || 0) + 1);
    });

    let maxCups = 0;
    let maxDayKey = '';
    dayCupCounts.forEach((cnt, key) => {
      if (cnt > maxCups) {
        maxCups = cnt;
        maxDayKey = key;
      }
    });

    if (periodType === 'all') {
      // All Time View: Day of week with highest average cups
      if (filteredCoffee.length === 0) {
        coffeePeakMetric = {
          title: 'Peak Coffee Day',
          value: 'N/A',
          subtext: 'No coffee logged yet',
          hasData: false,
        };
      } else {
        const sortedDates = Array.from(dayCupCounts.keys()).sort();
        const earliestDate = new Date(`${sortedDates[0]}T00:00:00.000`);
        const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        const weekdayOccurrences = new Array(7).fill(0);
        const weekdayTotalCups = new Array(7).fill(0);

        const cur = new Date(earliestDate.getTime());
        while (cur <= todayDate) {
          weekdayOccurrences[cur.getDay()] += 1;
          cur.setDate(cur.getDate() + 1);
        }

        dayCupCounts.forEach((count, dKey) => {
          const d = new Date(`${dKey}T00:00:00.000`);
          weekdayTotalCups[d.getDay()] += count;
        });

        let bestWeekday = 1;
        let highestAvgCups = -1;
        for (let i = 0; i < 7; i++) {
          const occ = weekdayOccurrences[i];
          if (occ > 0) {
            const avg = weekdayTotalCups[i] / occ;
            if (avg > highestAvgCups) {
              highestAvgCups = avg;
              bestWeekday = i;
            }
          }
        }

        coffeePeakMetric = {
          title: 'Peak Coffee Day',
          value: highestAvgCups > 0 ? `${WEEKDAY_NAMES[bestWeekday]}s` : 'N/A',
          subtext: highestAvgCups > 0
            ? `${highestAvgCups.toFixed(1)} cups avg per ${WEEKDAY_NAMES[bestWeekday].slice(0, 3)}`
            : 'No coffee logged yet',
          hasData: highestAvgCups > 0,
        };
      }
    } else if (periodType === 'week') {
      if (maxCups > 0) {
        const d = new Date(`${maxDayKey}T00:00:00.000`);
        coffeePeakMetric = {
          title: 'Peak Coffee Day',
          value: WEEKDAY_NAMES[d.getDay()],
          subtext: `${maxCups} ${maxCups === 1 ? 'cup' : 'cups'} logged`,
          hasData: true,
        };
      } else {
        coffeePeakMetric = {
          title: 'Peak Coffee Day',
          value: 'N/A',
          subtext: 'No coffee logged this week',
          hasData: false,
        };
      }
    } else if (periodType === 'month') {
      if (maxCups > 0) {
        const d = new Date(`${maxDayKey}T00:00:00.000`);
        coffeePeakMetric = {
          title: 'Peak Coffee Day',
          value: `${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0, 3)}`,
          subtext: `${maxCups} ${maxCups === 1 ? 'cup' : 'cups'} logged`,
          hasData: true,
        };
      } else {
        coffeePeakMetric = {
          title: 'Peak Coffee Day',
          value: 'N/A',
          subtext: 'No coffee logged this month',
          hasData: false,
        };
      }
    } else if (periodType === 'year') {
      const monthCupCounts = new Array(12).fill(0);
      filteredCoffee.forEach((c) => {
        const m = new Date(`${c.date}T00:00:00.000`).getMonth();
        monthCupCounts[m] += 1;
      });
      let maxMonthIdx = 0;
      let maxMonthCups = 0;
      monthCupCounts.forEach((cnt, idx) => {
        if (cnt > maxMonthCups) {
          maxMonthCups = cnt;
          maxMonthIdx = idx;
        }
      });

      if (maxMonthCups > 0) {
        coffeePeakMetric = {
          title: 'Peak Coffee Month',
          value: MONTH_NAMES[maxMonthIdx],
          subtext: `${maxMonthCups} ${maxMonthCups === 1 ? 'cup' : 'cups'} logged`,
          hasData: true,
        };
      } else {
        coffeePeakMetric = {
          title: 'Peak Coffee Month',
          value: 'N/A',
          subtext: 'No coffee logged this year',
          hasData: false,
        };
      }
    } else if (periodType === 'day') {
      const tagCounts = new Map<string | null, number>();
      filteredCoffee.forEach((c) => {
        tagCounts.set(c.tagId || null, (tagCounts.get(c.tagId || null) || 0) + 1);
      });
      let topTagId: string | null = null;
      let topTagCount = 0;
      tagCounts.forEach((cnt, tid) => {
        if (cnt > topTagCount) {
          topTagCount = cnt;
          topTagId = tid;
        }
      });

      const isCurrentDay = toDateKey(referenceDate) === todayKey;
      if (topTagCount > 0) {
        const found = tags.find((t) => t.id === topTagId);
        const tagName = topTagId ? (found ? found.name : 'Unknown') : 'No Tag';
        coffeePeakMetric = {
          title: isCurrentDay ? 'Top Tag Today' : 'Top Tag For Day',
          value: tagName,
          subtext: `${topTagCount} ${topTagCount === 1 ? 'cup' : 'cups'} logged`,
          hasData: true,
        };
      } else {
        coffeePeakMetric = {
          title: isCurrentDay ? 'Top Tag Today' : 'Top Tag For Day',
          value: 'N/A',
          subtext: isCurrentDay ? 'No coffee logged today' : 'No coffee logged for day',
          hasData: false,
        };
      }
    } else {
      // custom
      if (maxCups > 0) {
        const d = new Date(`${maxDayKey}T00:00:00.000`);
        coffeePeakMetric = {
          title: 'Peak Coffee Day',
          value: `${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0, 3)}`,
          subtext: `${maxCups} ${maxCups === 1 ? 'cup' : 'cups'} logged`,
          hasData: true,
        };
      } else {
        coffeePeakMetric = {
          title: 'Peak Coffee Day',
          value: 'N/A',
          subtext: 'No coffee logged in range',
          hasData: false,
        };
      }
    }

    return {
      periodLabel,
      totalFocusSeconds,
      totalFocusHours,
      totalWorkCount,
      totalCoffeeCups,
      coffeeDailyAverage,
      coffeeElapsedDays,
      coffeePeakMetric,
      tagDistribution,
      activityBars,
      productiveMetric,
    };
  }, [sessions, tags, coffeeCups, periodType, referenceDate, customRange, isCurrentPeriod, todayKey]);

  return {
    periodType,
    setPeriodType,
    periodLabel: stats.periodLabel,
    customRange,
    setCustomRange,
    goToPrev,
    goToNext,
    goToToday,
    canGoNext,
    isCurrentPeriod,
    totalFocusSeconds: stats.totalFocusSeconds,
    totalFocusHours: stats.totalFocusHours,
    totalWorkCount: stats.totalWorkCount,
    totalCoffeeCups: stats.totalCoffeeCups,
    coffeeDailyAverage: stats.coffeeDailyAverage,
    coffeeElapsedDays: stats.coffeeElapsedDays,
    coffeePeakMetric: stats.coffeePeakMetric,
    tagDistribution: stats.tagDistribution,
    activityBars: stats.activityBars,
    productiveMetric: stats.productiveMetric,
  };
}

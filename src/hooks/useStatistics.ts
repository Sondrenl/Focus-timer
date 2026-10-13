import { useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { toDateKey, WEEKDAY_NAMES, formatFriendlyDate } from '../utils/dates';

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

export interface DailyActivityStat {
  dateKey: string;
  label: string;
  totalSeconds: number;
  hours: number;
  sessionCount: number;
}

export interface DayOfWeekStat {
  weekdayIndex: number;
  dayName: string;
  totalSeconds: number;
  hours: number;
  sessionCount: number;
}

export function useStatistics() {
  const { sessions, tags } = useApp();

  return useMemo(() => {
    // Only aggregate WORK sessions for focus metrics
    const workSessions = sessions.filter((s) => s.sessionType === 'WORK');

    // 1. Total Aggregates
    const totalFocusSeconds = workSessions.reduce((acc, s) => acc + s.durationSeconds, 0);
    const totalFocusHours = Number((totalFocusSeconds / 3600).toFixed(1));
    const totalWorkCount = workSessions.length;

    // Map tags for quick lookup
    const tagMap = new Map<string, { name: string; color: string; isArchived: boolean }>();
    tags.forEach((t) => {
      tagMap.set(t.id, { name: t.name, color: t.color, isArchived: t.isArchived });
    });

    // 2. Per-Tag Distribution
    const tagSecondsMap = new Map<string, { seconds: number; count: number }>();
    workSessions.forEach((s) => {
      const tagId = s.tagId || 'untagged';
      const curr = tagSecondsMap.get(tagId) || { seconds: 0, count: 0 };
      tagSecondsMap.set(tagId, {
        seconds: curr.seconds + s.durationSeconds,
        count: curr.count + 1,
      });
    });

    const tagDistribution: TagStat[] = Array.from(tagSecondsMap.entries()).map(([tagId, data]) => {
      let name = 'Untagged';
      let color = '#9E9E9E';
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

    // Sort descending by total duration
    tagDistribution.sort((a, b) => b.totalSeconds - a.totalSeconds);

    // 3. Daily Activity Log (Last 7 days window)
    const dailyMap = new Map<string, { seconds: number; count: number }>();
    const now = new Date();
    // Pre-populate last 7 days so days with 0 activity show as bars
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = toDateKey(d);
      dailyMap.set(key, { seconds: 0, count: 0 });
    }

    workSessions.forEach((s) => {
      const key = toDateKey(s.completedAt);
      if (dailyMap.has(key)) {
        const curr = dailyMap.get(key)!;
        dailyMap.set(key, {
          seconds: curr.seconds + s.durationSeconds,
          count: curr.count + 1,
        });
      }
    });

    const dailyActivity: DailyActivityStat[] = Array.from(dailyMap.entries()).map(([dateKey, data]) => ({
      dateKey,
      label: formatFriendlyDate(dateKey),
      totalSeconds: data.seconds,
      hours: Number((data.seconds / 3600).toFixed(1)),
      sessionCount: data.count,
    }));

    // 4. Productivity Metric: Most productive day of the week
    const weekdayTotals: { [key: number]: { seconds: number; count: number; distinctDates: Set<string> } } = {};
    for (let i = 0; i < 7; i++) {
      weekdayTotals[i] = { seconds: 0, count: 0, distinctDates: new Set() };
    }

    workSessions.forEach((s) => {
      const d = new Date(s.completedAt);
      const dayIdx = d.getDay();
      const dateKey = toDateKey(d);
      weekdayTotals[dayIdx].seconds += s.durationSeconds;
      weekdayTotals[dayIdx].count += 1;
      weekdayTotals[dayIdx].distinctDates.add(dateKey);
    });

    let bestDayIdx = 1; // Default to Monday
    let maxSeconds = -1;

    for (let i = 0; i < 7; i++) {
      if (weekdayTotals[i].seconds > maxSeconds) {
        maxSeconds = weekdayTotals[i].seconds;
        bestDayIdx = i;
      }
    }

    const mostProductiveDay = {
      dayName: WEEKDAY_NAMES[bestDayIdx],
      totalHours: Number((weekdayTotals[bestDayIdx].seconds / 3600).toFixed(1)),
      sessionCount: weekdayTotals[bestDayIdx].count,
      hasData: maxSeconds > 0,
    };

    return {
      totalFocusSeconds,
      totalFocusHours,
      totalWorkCount,
      tagDistribution,
      dailyActivity,
      mostProductiveDay,
    };
  }, [sessions, tags]);
}

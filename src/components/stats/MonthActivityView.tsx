import React, { useMemo } from 'react';
import { ActivityBarStat } from '../../hooks/useStatistics';
import { formatCompactDuration } from '../../utils/formatters';
import { MONTH_NAMES, toDateKey } from '../../utils/dates';
import {
  buildWeeklyRhythmGroups,
  WeeklyRhythmBreakdown,
} from './WeeklyRhythmBreakdown';

interface MonthActivityViewProps {
  activityBars: ActivityBarStat[];
}

export const MonthActivityView: React.FC<MonthActivityViewProps> = ({ activityBars }) => {
  const todayKey = toDateKey(new Date());

  // Parse Year and Month from the first bar's key (format 'YYYY-MM-DD')
  const { year, monthIndex, daysInMonth, monthName } = useMemo(() => {
    if (activityBars.length === 0) {
      const now = new Date();
      return {
        year: now.getFullYear(),
        monthIndex: now.getMonth(),
        daysInMonth: 30,
        monthName: MONTH_NAMES[now.getMonth()],
      };
    }

    const [y, m] = activityBars[0].key.split('-').map(Number);
    const monthIdx = m - 1;
    const totalDays = new Date(y, m, 0).getDate();

    return {
      year: y,
      monthIndex: monthIdx,
      daysInMonth: totalDays,
      monthName: MONTH_NAMES[monthIdx],
    };
  }, [activityBars]);

  // Map of dateKey -> bar
  const dayMap = useMemo(() => {
    const map = new Map<string, ActivityBarStat>();
    activityBars.forEach((bar) => map.set(bar.key, bar));
    return map;
  }, [activityBars]);

  // Total active days in month
  const totalActiveDays = useMemo(() => {
    return activityBars.filter((b) => b.totalSeconds > 0).length;
  }, [activityBars]);

  const totalFocusSeconds = useMemo(() => {
    return activityBars.reduce((acc, b) => acc + b.totalSeconds, 0);
  }, [activityBars]);

  const avgPerActiveDaySec = useMemo(() => {
    return totalActiveDays > 0 ? Math.round(totalFocusSeconds / totalActiveDays) : 0;
  }, [totalFocusSeconds, totalActiveDays]);

  const consistencyPct = useMemo(() => {
    return daysInMonth > 0 ? Math.round((totalActiveDays / daysInMonth) * 100) : 0;
  }, [totalActiveDays, daysInMonth]);

  // Group all days of the month into natural calendar weeks (Monday–Sunday)
  const weeksData = useMemo(() => {
    if (activityBars.length === 0) return [];

    const monthDays = Array.from({ length: daysInMonth }, (_, idx) => {
      const dayNum = idx + 1;
      const dateKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      const bar = dayMap.get(dateKey);
      return {
        dateKey,
        totalSeconds: bar ? bar.totalSeconds : 0,
        sessionCount: bar ? bar.sessionCount : 0,
        tooltipLabel: `${dayNum} ${monthName}`,
      };
    });

    return buildWeeklyRhythmGroups(monthDays, todayKey, { compactSameMonthLabel: true });
  }, [activityBars.length, year, monthIndex, daysInMonth, monthName, dayMap, todayKey]);

  if (totalFocusSeconds === 0) {
    return (
      <div className="text-center py-8 text-xs text-md-outline">
        No focus sessions logged in {monthName}.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Monthly Attendance & Pace Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 p-3 rounded-2xl bg-md-surface-container/40 border border-md-outline-variant/20 text-xs">
        <div>
          <span className="text-md-outline block text-[11px]">Monthly Attendance</span>
          <span className="font-bold text-md-on-surface text-sm">
            {totalActiveDays} of {daysInMonth} days <span className="text-[11px] font-normal text-md-outline">({consistencyPct}%)</span>
          </span>
        </div>
        <div>
          <span className="text-md-outline block text-[11px]">Daily Pace</span>
          <span className="font-bold text-md-on-surface text-sm">
            {avgPerActiveDaySec > 0 ? `${formatCompactDuration(avgPerActiveDaySec)} / active day` : '—'}
          </span>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <span className="text-md-outline block text-[11px]">Weekly Average</span>
          <span className="font-bold text-md-on-surface text-sm">
            {weeksData.length > 0 ? `${formatCompactDuration(Math.round(totalFocusSeconds / weeksData.length))} / week` : '—'}
          </span>
        </div>
      </div>

      {/* Weekly Rhythm Breakdown Cards */}
      <WeeklyRhythmBreakdown weeks={weeksData} keyPrefix="month-week" />
    </div>
  );
};

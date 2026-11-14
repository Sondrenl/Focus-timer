import React, { useMemo } from 'react';
import { ActivityBarStat } from '../../hooks/useStatistics';
import { formatDurationHoursMins, formatCompactDuration } from '../../utils/formatters';
import { MONTH_NAMES, toDateKey } from '../../utils/dates';
import { clsx } from 'clsx';

interface MonthActivityViewProps {
  activityBars: ActivityBarStat[];
}

const SHORT_WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

interface MonthWeekData {
  weekNumber: number;
  label: string;
  totalSeconds: number;
  sessionCount: number;
  activeDaysCount: number;
  isCurrentWeek: boolean;
  days: {
    dateKey: string;
    dayNum: number;
    weekdayIndex: number; // 0=Mon, 6=Sun
    totalSeconds: number;
    sessionCount: number;
    isInMonth: boolean;
    isToday: boolean;
  }[];
}

export const MonthActivityView: React.FC<MonthActivityViewProps> = ({ activityBars }) => {
  const todayKey = useMemo(() => toDateKey(new Date()), []);

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
  const weeksData = useMemo<MonthWeekData[]>(() => {
    if (activityBars.length === 0) return [];

    const weeks: MonthWeekData[] = [];
    let currentWeekDays: MonthWeekData['days'] = [];
    let weekIndex = 1;

    // Fill days 1..daysInMonth
    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
      const dateKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      const dateObj = new Date(year, monthIndex, dayNum);
      const weekdayIndex = (dateObj.getDay() + 6) % 7; // Mon=0 .. Sun=6
      const bar = dayMap.get(dateKey);
      const isToday = dateKey === todayKey;

      // On first day of week or first day of month, pad leading empty days
      if (dayNum === 1 && weekdayIndex > 0) {
        for (let pad = 0; pad < weekdayIndex; pad++) {
          currentWeekDays.push({
            dateKey: `pad-pre-${pad}`,
            dayNum: 0,
            weekdayIndex: pad,
            totalSeconds: 0,
            sessionCount: 0,
            isInMonth: false,
            isToday: false,
          });
        }
      }

      currentWeekDays.push({
        dateKey,
        dayNum,
        weekdayIndex,
        totalSeconds: bar ? bar.totalSeconds : 0,
        sessionCount: bar ? bar.sessionCount : 0,
        isInMonth: true,
        isToday,
      });

      // Close week on Sunday or end of month
      if (weekdayIndex === 6 || dayNum === daysInMonth) {
        // Pad trailing days if end of month didn't finish on Sunday
        if (dayNum === daysInMonth && weekdayIndex < 6) {
          for (let pad = weekdayIndex + 1; pad <= 6; pad++) {
            currentWeekDays.push({
              dateKey: `pad-post-${pad}`,
              dayNum: 0,
              weekdayIndex: pad,
              totalSeconds: 0,
              sessionCount: 0,
              isInMonth: false,
              isToday: false,
            });
          }
        }

        const inMonthDays = currentWeekDays.filter((d) => d.isInMonth);
        const firstDayNum = inMonthDays[0]?.dayNum || 1;
        const lastDayNum = inMonthDays[inMonthDays.length - 1]?.dayNum || daysInMonth;
        const weekSeconds = inMonthDays.reduce((acc, d) => acc + d.totalSeconds, 0);
        const weekSessions = inMonthDays.reduce((acc, d) => acc + d.sessionCount, 0);
        const weekActiveDays = inMonthDays.filter((d) => d.totalSeconds > 0).length;
        const isCurrentWeek = inMonthDays.some((d) => d.isToday);

        weeks.push({
          weekNumber: weekIndex,
          label: `${firstDayNum} – ${lastDayNum} ${monthName.slice(0, 3)}`,
          totalSeconds: weekSeconds,
          sessionCount: weekSessions,
          activeDaysCount: weekActiveDays,
          isCurrentWeek,
          days: currentWeekDays,
        });

        currentWeekDays = [];
        weekIndex++;
      }
    }

    return weeks;
  }, [activityBars, year, monthIndex, daysInMonth, monthName, dayMap, todayKey]);

  const maxWeekSeconds = useMemo(() => {
    return Math.max(1, ...weeksData.map((w) => w.totalSeconds));
  }, [weeksData]);

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

      {/* Weekly Rhythm Breakdown Cards (Zero day shading!) */}
      <div className="flex flex-col gap-2.5">
        {weeksData.map((week) => {
          const widthPct = maxWeekSeconds > 0 ? Math.round((week.totalSeconds / maxWeekSeconds) * 100) : 0;

          return (
            <div
              key={`month-week-${week.weekNumber}`}
              className={clsx(
                'p-3 sm:p-3.5 rounded-2xl border transition-colors flex flex-col gap-2.5',
                week.isCurrentWeek
                  ? 'bg-md-primary/5 border-md-primary/30 ring-1 ring-md-primary/20'
                  : 'bg-md-surface-container/40 border-md-outline-variant/20 hover:bg-md-surface-container/60'
              )}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                {/* Week Label & Date Range */}
                <div className="flex items-center gap-2.5 min-w-[130px] shrink-0">
                  <span className="text-xs font-bold text-md-on-surface">
                    Week {week.weekNumber}
                  </span>
                  <span className="text-[11px] font-medium text-md-outline">
                    {week.label}
                  </span>
                  {week.isCurrentWeek && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-md-primary text-white leading-none">
                      CURRENT
                    </span>
                  )}
                </div>

                {/* Discrete Habit Pips (Mon to Sun) - Instant habit view, zero shading! */}
                <div className="flex items-center gap-1.5 self-start sm:self-auto">
                  {week.days.map((d) => {
                    const dayLetter = SHORT_WEEKDAYS[d.weekdayIndex];
                    if (!d.isInMonth) {
                      return (
                        <div
                          key={d.dateKey}
                          className="w-6 h-6 rounded-lg opacity-15 flex items-center justify-center text-[10px] text-md-outline"
                        >
                          {dayLetter}
                        </div>
                      );
                    }

                    const hasFocus = d.totalSeconds > 0;

                    return (
                      <div
                        key={d.dateKey}
                        title={hasFocus ? `${d.dayNum} ${monthName}: ${formatDurationHoursMins(d.totalSeconds)} (${d.sessionCount} sessions)` : `${d.dayNum} ${monthName}: No focus`}
                        className={clsx(
                          'w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold transition-all',
                          hasFocus
                            ? 'bg-md-primary text-white shadow-xs'
                            : d.isToday
                            ? 'border border-md-primary/60 text-md-primary'
                            : 'bg-md-surface-container-high/80 text-md-outline/60'
                        )}
                      >
                        {dayLetter}
                      </div>
                    );
                  })}
                </div>

                {/* Duration & Session Count on Right */}
                <div className="text-left sm:text-right flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 min-w-[110px] shrink-0">
                  <span className="text-xs font-bold tabular-nums text-md-on-surface">
                    {week.totalSeconds > 0 ? formatDurationHoursMins(week.totalSeconds) : '0m'}
                  </span>
                  <span className="text-[10px] text-md-on-surface-variant font-medium">
                    {week.sessionCount > 0 ? `${week.sessionCount} ${week.sessionCount === 1 ? 'session' : 'sessions'}` : '—'}
                  </span>
                </div>
              </div>

              {/* Weekly Volume Bar */}
              <div className="w-full h-1.5 bg-md-surface-container-highest/60 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-md-primary transition-all duration-500 ease-out"
                  style={{ width: `${Math.max(week.totalSeconds > 0 ? 6 : 0, widthPct)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

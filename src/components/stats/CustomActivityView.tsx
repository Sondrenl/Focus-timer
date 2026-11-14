import React, { useMemo } from 'react';
import { ActivityBarStat } from '../../hooks/useStatistics';
import { formatDurationHoursMins, formatCompactDuration } from '../../utils/formatters';
import { MONTH_NAMES, toDateKey } from '../../utils/dates';
import { clsx } from 'clsx';

interface CustomActivityViewProps {
  activityBars: ActivityBarStat[];
}

const SHORT_WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

interface CustomWeekData {
  weekNumber: number;
  label: string;
  totalSeconds: number;
  sessionCount: number;
  activeDaysCount: number;
  isCurrentWeek: boolean;
  days: {
    dateKey: string;
    dayNum: number;
    weekdayIndex: number;
    totalSeconds: number;
    sessionCount: number;
    isInRange: boolean;
    isToday: boolean;
  }[];
}

export const CustomActivityView: React.FC<CustomActivityViewProps> = ({ activityBars }) => {
  const totalDays = activityBars.length;
  const todayKey = useMemo(() => toDateKey(new Date()), []);

  const activeDaysCount = useMemo(() => {
    return activityBars.filter((b) => b.totalSeconds > 0).length;
  }, [activityBars]);

  const totalFocusSeconds = useMemo(() => {
    return activityBars.reduce((acc, b) => acc + b.totalSeconds, 0);
  }, [activityBars]);

  const avgPerActiveDaySec = useMemo(() => {
    return activeDaysCount > 0 ? Math.round(totalFocusSeconds / activeDaysCount) : 0;
  }, [totalFocusSeconds, activeDaysCount]);

  const consistencyPct = useMemo(() => {
    return totalDays > 0 ? Math.round((activeDaysCount / totalDays) * 100) : 0;
  }, [activeDaysCount, totalDays]);

  const maxDaySeconds = useMemo(() => {
    return Math.max(1, ...activityBars.map((b) => b.totalSeconds));
  }, [activityBars]);

  // Group into calendar weeks for ranges > 7 days
  const weeklyGroups = useMemo<CustomWeekData[]>(() => {
    if (activityBars.length === 0) return [];

    const weeks: CustomWeekData[] = [];
    let currentWeekDays: CustomWeekData['days'] = [];
    let weekIndex = 1;

    for (let i = 0; i < activityBars.length; i++) {
      const bar = activityBars[i];
      const [y, m, d] = bar.key.split('-').map(Number);
      const dateObj = new Date(y, m - 1, d);
      const weekdayIndex = (dateObj.getDay() + 6) % 7; // Mon=0 .. Sun=6
      const isToday = bar.key === todayKey;

      // On first item, if not Monday, pad leading
      if (i === 0 && weekdayIndex > 0) {
        for (let pad = 0; pad < weekdayIndex; pad++) {
          currentWeekDays.push({
            dateKey: `pad-pre-${pad}`,
            dayNum: 0,
            weekdayIndex: pad,
            totalSeconds: 0,
            sessionCount: 0,
            isInRange: false,
            isToday: false,
          });
        }
      }

      currentWeekDays.push({
        dateKey: bar.key,
        dayNum: d,
        weekdayIndex,
        totalSeconds: bar.totalSeconds,
        sessionCount: bar.sessionCount,
        isInRange: true,
        isToday,
      });

      // Close week on Sunday or last item
      if (weekdayIndex === 6 || i === activityBars.length - 1) {
        if (i === activityBars.length - 1 && weekdayIndex < 6) {
          for (let pad = weekdayIndex + 1; pad <= 6; pad++) {
            currentWeekDays.push({
              dateKey: `pad-post-${pad}`,
              dayNum: 0,
              weekdayIndex: pad,
              totalSeconds: 0,
              sessionCount: 0,
              isInRange: false,
              isToday: false,
            });
          }
        }

        const inRangeDays = currentWeekDays.filter((d) => d.isInRange);
        const sKey = inRangeDays[0]?.dateKey || '';
        const eKey = inRangeDays[inRangeDays.length - 1]?.dateKey || '';
        const formatShort = (key: string) => {
          if (!key) return '';
          const [, mNum, dNum] = key.split('-').map(Number);
          return `${dNum} ${MONTH_NAMES[mNum - 1]?.slice(0, 3) || ''}`;
        };

        const weekSec = inRangeDays.reduce((acc, d) => acc + d.totalSeconds, 0);
        const weekSes = inRangeDays.reduce((acc, d) => acc + d.sessionCount, 0);
        const weekActive = inRangeDays.filter((d) => d.totalSeconds > 0).length;
        const isCurrentWeek = inRangeDays.some((d) => d.isToday);

        weeks.push({
          weekNumber: weekIndex,
          label: `${formatShort(sKey)} – ${formatShort(eKey)}`,
          totalSeconds: weekSec,
          sessionCount: weekSes,
          activeDaysCount: weekActive,
          isCurrentWeek,
          days: currentWeekDays,
        });

        currentWeekDays = [];
        weekIndex++;
      }
    }

    return weeks;
  }, [activityBars, todayKey]);

  const maxWeekSeconds = useMemo(() => {
    return Math.max(1, ...weeklyGroups.map((w) => w.totalSeconds));
  }, [weeklyGroups]);

  if (totalDays === 0 || totalFocusSeconds === 0) {
    return (
      <div className="text-center py-8 text-xs text-md-outline">
        No focus sessions logged in this custom range.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Range Quick Metrics Header (Non-duplicative) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded-2xl bg-md-surface-container/40 border border-md-outline-variant/20 text-xs">
        <div>
          <span className="text-md-outline block text-[11px]">Range Length</span>
          <span className="font-bold text-md-on-surface text-sm">{totalDays} days</span>
        </div>
        <div>
          <span className="text-md-outline block text-[11px]">Active Days</span>
          <span className="font-bold text-md-on-surface text-sm">
            {activeDaysCount} of {totalDays}
          </span>
        </div>
        <div>
          <span className="text-md-outline block text-[11px]">Consistency</span>
          <span className="font-bold text-md-on-surface text-sm">{consistencyPct}%</span>
        </div>
        <div>
          <span className="text-md-outline block text-[11px]">Avg / Active Day</span>
          <span className="font-bold text-md-on-surface text-sm">
            {avgPerActiveDaySec > 0 ? formatCompactDuration(avgPerActiveDaySec) : '—'}
          </span>
        </div>
      </div>

      {totalDays <= 7 ? (
        /* Daily Column Bar Chart for Short Ranges <= 7 days */
        <div className="flex items-end justify-between gap-1.5 sm:gap-3 h-44 sm:h-52 pt-6 pb-2 px-1 sm:px-2 rounded-2xl bg-md-surface-container/30 border border-md-outline-variant/20 select-none">
          {activityBars.map((bar) => {
            const isToday = bar.key === todayKey;
            const heightPct = maxDaySeconds > 0 ? Math.round((bar.totalSeconds / maxDaySeconds) * 100) : 0;

            return (
              <div
                key={bar.key}
                className="flex-1 h-full flex flex-col items-center justify-end gap-1.5 p-1 rounded-xl"
              >
                <div className="text-[10px] sm:text-xs font-bold tabular-nums min-h-[16px] text-center">
                  {bar.totalSeconds > 0 ? (
                    <span className="text-md-on-surface-variant font-semibold">
                      {formatCompactDuration(bar.totalSeconds)}
                    </span>
                  ) : (
                    <span className="text-md-outline/30">—</span>
                  )}
                </div>

                <div className="w-full max-w-[36px] sm:max-w-[48px] flex-1 bg-md-surface-container-high rounded-xl overflow-hidden flex flex-col justify-end p-0.5 border border-transparent">
                  <div
                    className={clsx(
                      'w-full rounded-lg transition-[height] duration-300 ease-out',
                      isToday ? 'bg-md-primary/90' : bar.totalSeconds > 0 ? 'bg-md-primary/70' : 'bg-transparent'
                    )}
                    style={{ height: `${bar.totalSeconds > 0 ? Math.max(8, heightPct) : 0}%` }}
                  />
                </div>

                <div className="flex flex-col items-center leading-none gap-0.5 pt-0.5">
                  <span className={clsx('text-[10px] sm:text-xs font-bold', isToday ? 'text-md-primary font-extrabold' : 'text-md-on-surface-variant')}>
                    {bar.label}
                  </span>
                  {bar.subLabel && (
                    <span className="text-[9px] text-md-outline tabular-nums">
                      {bar.subLabel}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Weekly Habit & Focus Rhythm for Ranges > 7 days (Zero Day-Shading!) */
        <div className="flex flex-col gap-2.5">
          {weeklyGroups.map((week) => {
            const widthPct = maxWeekSeconds > 0 ? Math.round((week.totalSeconds / maxWeekSeconds) * 100) : 0;

            return (
              <div
                key={`custom-week-${week.weekNumber}`}
                className={clsx(
                  'p-3 sm:p-3.5 rounded-2xl border transition-colors flex flex-col gap-2.5',
                  week.isCurrentWeek
                    ? 'bg-md-primary/5 border-md-primary/30 ring-1 ring-md-primary/20'
                    : 'bg-md-surface-container/40 border-md-outline-variant/20 hover:bg-md-surface-container/60'
                )}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2.5 min-w-[140px] shrink-0">
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

                  {/* Discrete Habit Pips */}
                  <div className="flex items-center gap-1.5 self-start sm:self-auto">
                    {week.days.map((d) => {
                      const dayLetter = SHORT_WEEKDAYS[d.weekdayIndex];
                      if (!d.isInRange) {
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
                          title={hasFocus ? `${d.dateKey}: ${formatDurationHoursMins(d.totalSeconds)} (${d.sessionCount} sessions)` : `${d.dateKey}: No focus`}
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

                  {/* Duration on Right */}
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
      )}
    </div>
  );
};

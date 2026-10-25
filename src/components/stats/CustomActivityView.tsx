import React, { useState, useMemo } from 'react';
import { ActivityBarStat } from '../../hooks/useStatistics';
import { formatDurationHoursMins } from '../../utils/formatters';
import { WEEKDAY_NAMES, MONTH_NAMES } from '../../utils/dates';
import { Filter } from 'lucide-react';
import { clsx } from 'clsx';

interface CustomActivityViewProps {
  activityBars: ActivityBarStat[];
}

export const CustomActivityView: React.FC<CustomActivityViewProps> = ({ activityBars }) => {
  const totalDays = activityBars.length;

  // Decide default granularity based on range duration
  const defaultMode: 'daily' | 'weekly' | 'monthly' =
    totalDays <= 31 ? 'daily' : totalDays <= 90 ? 'weekly' : 'monthly';

  const [granularity, setGranularity] = useState<'daily' | 'weekly' | 'monthly'>(defaultMode);
  const [showActiveOnly, setShowActiveOnly] = useState<boolean>(false);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);

  // Summary Metrics
  const activeDaysCount = useMemo(() => {
    return activityBars.filter((b) => b.totalSeconds > 0).length;
  }, [activityBars]);

  const totalFocusSeconds = useMemo(() => {
    return activityBars.reduce((acc, b) => acc + b.totalSeconds, 0);
  }, [activityBars]);

  const totalSessionsCount = useMemo(() => {
    return activityBars.reduce((acc, b) => acc + b.sessionCount, 0);
  }, [activityBars]);

  const avgPerActiveDaySec = useMemo(() => {
    if (activeDaysCount === 0) return 0;
    return Math.round(totalFocusSeconds / activeDaysCount);
  }, [totalFocusSeconds, activeDaysCount]);

  const maxDaySeconds = useMemo(() => {
    return Math.max(1, ...activityBars.map((b) => b.totalSeconds));
  }, [activityBars]);

  // Group into calendar weeks (Monday to Sunday)
  const weeklyGroups = useMemo(() => {
    if (activityBars.length === 0) return [];

    const weeks: {
      weekIndex: number;
      label: string;
      totalSeconds: number;
      sessionCount: number;
      activeDays: number;
      days: ActivityBarStat[];
    }[] = [];

    let currentWeekDays: ActivityBarStat[] = [];
    let weekCounter = 1;

    for (let i = 0; i < activityBars.length; i++) {
      const bar = activityBars[i];
      const [y, m, d] = bar.key.split('-').map(Number);
      const dateObj = new Date(y, m - 1, d);
      const dow = (dateObj.getDay() + 6) % 7; // Monday = 0, Sunday = 6

      currentWeekDays.push(bar);

      // Break at Sunday or at the end of the range
      if (dow === 6 || i === activityBars.length - 1) {
        const first = currentWeekDays[0];
        const last = currentWeekDays[currentWeekDays.length - 1];

        const [, fm, fd] = first.key.split('-').map(Number);
        const [, lm, ld] = last.key.split('-').map(Number);

        const firstLabel = `${fd} ${MONTH_NAMES[fm - 1].slice(0, 3)}`;
        const lastLabel = `${ld} ${MONTH_NAMES[lm - 1].slice(0, 3)}`;

        const sLabel = firstLabel === lastLabel ? firstLabel : `${firstLabel} – ${lastLabel}`;
        const sec = currentWeekDays.reduce((acc, b) => acc + b.totalSeconds, 0);
        const count = currentWeekDays.reduce((acc, b) => acc + b.sessionCount, 0);
        const active = currentWeekDays.filter((b) => b.totalSeconds > 0).length;

        weeks.push({
          weekIndex: weekCounter++,
          label: sLabel,
          totalSeconds: sec,
          sessionCount: count,
          activeDays: active,
          days: currentWeekDays,
        });

        currentWeekDays = [];
      }
    }

    return weeks;
  }, [activityBars]);

  const maxWeekSeconds = useMemo(() => {
    return Math.max(1, ...weeklyGroups.map((w) => w.totalSeconds));
  }, [weeklyGroups]);

  // Group into calendar months (if range spans multiple months)
  const monthlyGroups = useMemo(() => {
    if (activityBars.length === 0) return [];

    const monthMap = new Map<string, { label: string; totalSeconds: number; sessionCount: number; activeDays: number }>();

    activityBars.forEach((bar) => {
      const [y, m] = bar.key.split('-').map(Number);
      const monthKey = `${y}-${String(m).padStart(2, '0')}`;
      const cur = monthMap.get(monthKey) || {
        label: `${MONTH_NAMES[m - 1]} ${y}`,
        totalSeconds: 0,
        sessionCount: 0,
        activeDays: 0,
      };

      cur.totalSeconds += bar.totalSeconds;
      cur.sessionCount += bar.sessionCount;
      if (bar.totalSeconds > 0) cur.activeDays += 1;
      monthMap.set(monthKey, cur);
    });

    return Array.from(monthMap.entries()).map(([key, data]) => ({
      key,
      ...data,
    }));
  }, [activityBars]);

  const maxMonthSeconds = useMemo(() => {
    return Math.max(1, ...monthlyGroups.map((m) => m.totalSeconds));
  }, [monthlyGroups]);

  // Filtered daily bars for display
  const dailyDisplayBars = useMemo(() => {
    if (!showActiveOnly) return activityBars;
    return activityBars.filter((b) => b.totalSeconds > 0);
  }, [activityBars, showActiveOnly]);

  const formatDailyTitle = (dateKey: string) => {
    const [y, m, d] = dateKey.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    const weekday = WEEKDAY_NAMES[dateObj.getDay()];
    return `${weekday.slice(0, 3)}, ${d} ${MONTH_NAMES[m - 1].slice(0, 3)}`;
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Range Quick Metrics Header */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded-2xl bg-md-surface-container/50 border border-md-outline-variant/20 text-xs">
        <div>
          <span className="text-md-outline block text-[11px]">Range Length</span>
          <span className="font-bold text-md-on-surface text-sm">{totalDays} days</span>
        </div>
        <div>
          <span className="text-md-outline block text-[11px]">Active Days</span>
          <span className="font-bold text-md-on-surface text-sm">
            {activeDaysCount} <span className="text-[11px] font-normal text-md-outline">({Math.round((activeDaysCount / Math.max(1, totalDays)) * 100)}%)</span>
          </span>
        </div>
        <div>
          <span className="text-md-outline block text-[11px]">Total Focus</span>
          <span className="font-bold text-md-primary text-sm">{formatDurationHoursMins(totalFocusSeconds)} <span className="text-[11px] font-normal text-md-outline">({totalSessionsCount})</span></span>
        </div>
        <div>
          <span className="text-md-outline block text-[11px]">Avg / Active Day</span>
          <span className="font-bold text-md-on-surface text-sm">{formatDurationHoursMins(avgPerActiveDaySec)}</span>
        </div>
      </div>

      {/* Granularity & Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Granularity Toggle */}
        <div className="inline-flex p-0.5 bg-md-surface-container rounded-xl border border-md-outline-variant/30 text-xs">
          <button
            type="button"
            onClick={() => setGranularity('daily')}
            className={clsx(
              'px-2.5 py-1 rounded-lg font-semibold transition-all flex items-center gap-1.5',
              granularity === 'daily'
                ? 'bg-md-primary-container text-md-on-primary-container shadow-xs'
                : 'text-md-on-surface-variant hover:text-md-on-surface'
            )}
          >
            <span>Days</span>
          </button>

          {totalDays >= 7 && (
            <button
              type="button"
              onClick={() => setGranularity('weekly')}
              className={clsx(
                'px-2.5 py-1 rounded-lg font-semibold transition-all flex items-center gap-1.5',
                granularity === 'weekly'
                  ? 'bg-md-primary-container text-md-on-primary-container shadow-xs'
                  : 'text-md-on-surface-variant hover:text-md-on-surface'
              )}
            >
              <span>Weeks</span>
            </button>
          )}

          {totalDays >= 35 && (
            <button
              type="button"
              onClick={() => setGranularity('monthly')}
              className={clsx(
                'px-2.5 py-1 rounded-lg font-semibold transition-all flex items-center gap-1.5',
                granularity === 'monthly'
                  ? 'bg-md-primary-container text-md-on-primary-container shadow-xs'
                  : 'text-md-on-surface-variant hover:text-md-on-surface'
              )}
            >
              <span>Months</span>
            </button>
          )}
        </div>

        {/* Daily Mode: Active Days Toggle */}
        {granularity === 'daily' && totalDays > 7 && (
          <button
            type="button"
            onClick={() => setShowActiveOnly((prev) => !prev)}
            className={clsx(
              'px-2.5 py-1 rounded-xl text-xs font-semibold border transition-all flex items-center gap-1.5',
              showActiveOnly
                ? 'bg-md-primary/10 border-md-primary/30 text-md-primary'
                : 'bg-md-surface-container/60 border-md-outline-variant/30 text-md-on-surface-variant hover:text-md-on-surface'
            )}
          >
            <Filter className="w-3 h-3" />
            <span>{showActiveOnly ? `Active Only (${activeDaysCount})` : 'Show All Days'}</span>
          </button>
        )}
      </div>

      {/* Main Breakdown Content */}
      {granularity === 'daily' ? (
        <div className="flex flex-col gap-2 max-h-96 overflow-y-auto pr-1 scrollbar-thin">
          {dailyDisplayBars.length === 0 ? (
            <div className="text-center py-8 text-xs text-md-outline">
              No active focus days in this custom range.
            </div>
          ) : (
            dailyDisplayBars.map((bar) => {
              const widthPct = maxDaySeconds > 0 ? Math.min(100, Math.round((bar.totalSeconds / maxDaySeconds) * 100)) : 0;
              const hasHours = bar.totalSeconds > 0;
              const isSelected = selectedDayKey === bar.key;

              return (
                <div
                  key={bar.key}
                  onClick={() => setSelectedDayKey((prev) => (prev === bar.key ? null : bar.key))}
                  className={clsx(
                    'flex items-center gap-3 p-2.5 rounded-2xl border transition-all cursor-pointer',
                    isSelected
                      ? 'bg-md-surface-container-high border-md-primary/50 shadow-xs'
                      : hasHours
                      ? 'bg-md-surface-container/60 border-transparent hover:bg-md-surface-container'
                      : 'bg-md-surface-container/20 border-transparent opacity-60 hover:opacity-100 hover:bg-md-surface-container/40'
                  )}
                >
                  <div className="w-28 shrink-0 flex flex-col">
                    <span className="text-xs font-bold text-md-on-surface truncate">
                      {formatDailyTitle(bar.key)}
                    </span>
                  </div>

                  <div className="flex-1 h-6 bg-md-surface-container-high rounded-lg overflow-hidden flex items-center p-0.5">
                    <div
                      className={clsx(
                        'h-full rounded-md transition-all duration-300',
                        hasHours ? 'bg-md-primary' : 'bg-transparent'
                      )}
                      style={{ width: `${Math.max(hasHours ? 6 : 0, widthPct)}%` }}
                    />
                  </div>

                  <div className="w-24 shrink-0 text-right flex flex-col items-end">
                    <span
                      className={clsx(
                        'text-xs font-bold tabular-nums',
                        hasHours ? 'text-md-on-surface' : 'text-md-outline'
                      )}
                    >
                      {hasHours ? formatDurationHoursMins(bar.totalSeconds) : '0m'}
                    </span>
                    {bar.sessionCount > 0 && (
                      <span className="text-[10px] text-md-on-surface-variant">
                        {bar.sessionCount} {bar.sessionCount === 1 ? 'session' : 'sessions'}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : granularity === 'weekly' ? (
        <div className="flex flex-col gap-2.5 max-h-96 overflow-y-auto pr-1 scrollbar-thin">
          {weeklyGroups.map((week) => {
            const widthPct = maxWeekSeconds > 0 ? Math.min(100, Math.round((week.totalSeconds / maxWeekSeconds) * 100)) : 0;
            const hasHours = week.totalSeconds > 0;

            return (
              <div
                key={`custom-week-${week.weekIndex}`}
                className="flex items-center gap-3 p-3 rounded-2xl bg-md-surface-container/60 hover:bg-md-surface-container transition-all"
              >
                <div className="w-32 sm:w-36 shrink-0 flex flex-col">
                  <span className="text-xs font-bold text-md-on-surface truncate">
                    Week {week.weekIndex}
                  </span>
                  <span className="text-[11px] text-md-outline truncate">
                    {week.label}
                  </span>
                </div>

                <div className="flex-1 h-7 bg-md-surface-container-high rounded-xl overflow-hidden flex items-center p-1">
                  <div
                    className={clsx(
                      'h-full rounded-lg transition-all duration-500 ease-out',
                      hasHours ? 'bg-md-primary' : 'bg-transparent'
                    )}
                    style={{ width: `${Math.max(hasHours ? 8 : 0, widthPct)}%` }}
                  />
                </div>

                <div className="w-24 shrink-0 text-right flex flex-col items-end">
                  <span
                    className={clsx(
                      'text-xs font-bold tabular-nums',
                      hasHours ? 'text-md-on-surface' : 'text-md-outline'
                    )}
                  >
                    {hasHours ? formatDurationHoursMins(week.totalSeconds) : '0m'}
                  </span>
                  <span className="text-[10px] text-md-on-surface-variant">
                    {week.activeDays} {week.activeDays === 1 ? 'day' : 'days'} active
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Monthly Groups Mode */
        <div className="flex flex-col gap-2.5 max-h-96 overflow-y-auto pr-1 scrollbar-thin">
          {monthlyGroups.map((month) => {
            const widthPct = maxMonthSeconds > 0 ? Math.min(100, Math.round((month.totalSeconds / maxMonthSeconds) * 100)) : 0;
            const hasHours = month.totalSeconds > 0;

            return (
              <div
                key={month.key}
                className="flex items-center gap-3 p-3 rounded-2xl bg-md-surface-container/60 hover:bg-md-surface-container transition-all"
              >
                <div className="w-32 sm:w-36 shrink-0 flex flex-col">
                  <span className="text-xs font-bold text-md-on-surface truncate">
                    {month.label}
                  </span>
                  <span className="text-[11px] text-md-outline truncate">
                    {month.activeDays} active days
                  </span>
                </div>

                <div className="flex-1 h-7 bg-md-surface-container-high rounded-xl overflow-hidden flex items-center p-1">
                  <div
                    className={clsx(
                      'h-full rounded-lg transition-all duration-500 ease-out',
                      hasHours ? 'bg-md-primary' : 'bg-transparent'
                    )}
                    style={{ width: `${Math.max(hasHours ? 8 : 0, widthPct)}%` }}
                  />
                </div>

                <div className="w-24 shrink-0 text-right flex flex-col items-end">
                  <span
                    className={clsx(
                      'text-xs font-bold tabular-nums',
                      hasHours ? 'text-md-on-surface' : 'text-md-outline'
                    )}
                  >
                    {hasHours ? formatDurationHoursMins(month.totalSeconds) : '0m'}
                  </span>
                  <span className="text-[10px] text-md-on-surface-variant">
                    {month.sessionCount} {month.sessionCount === 1 ? 'session' : 'sessions'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

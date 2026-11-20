import React, { useMemo } from 'react';
import { ActivityBarStat } from '../../hooks/useStatistics';
import { formatCompactDuration } from '../../utils/formatters';
import { toDateKey } from '../../utils/dates';
import { clsx } from 'clsx';
import {
  buildWeeklyRhythmGroups,
  WeeklyRhythmBreakdown,
} from './WeeklyRhythmBreakdown';

interface CustomActivityViewProps {
  activityBars: ActivityBarStat[];
}

export const CustomActivityView: React.FC<CustomActivityViewProps> = ({ activityBars }) => {
  const totalDays = activityBars.length;
  const todayKey = toDateKey(new Date());

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
  const weeklyGroups = useMemo(() => {
    if (activityBars.length === 0) return [];
    return buildWeeklyRhythmGroups(
      activityBars.map((bar) => ({
        dateKey: bar.key,
        totalSeconds: bar.totalSeconds,
        sessionCount: bar.sessionCount,
      })),
      todayKey
    );
  }, [activityBars, todayKey]);

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
        /* Weekly Habit & Focus Rhythm for Ranges > 7 days */
        <WeeklyRhythmBreakdown weeks={weeklyGroups} keyPrefix="custom-week" />
      )}
    </div>
  );
};

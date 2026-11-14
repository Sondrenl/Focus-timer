import React, { useState, useMemo } from 'react';
import { ActivityBarStat } from '../../hooks/useStatistics';
import { formatDurationHoursMins, formatCompactDuration } from '../../utils/formatters';
import { WEEKDAY_NAMES, MONTH_NAMES, toDateKey } from '../../utils/dates';
import { clsx } from 'clsx';

interface WeekActivityViewProps {
  activityBars: ActivityBarStat[];
}

export const WeekActivityView: React.FC<WeekActivityViewProps> = ({ activityBars }) => {
  const [hoveredDayKey, setHoveredDayKey] = useState<string | null>(null);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);

  const todayKey = useMemo(() => toDateKey(new Date()), []);

  const dayMap = useMemo(() => {
    const map = new Map<string, ActivityBarStat>();
    activityBars.forEach((bar) => map.set(bar.key, bar));
    return map;
  }, [activityBars]);

  const maxDaySeconds = useMemo(() => {
    return Math.max(1, ...activityBars.map((b) => b.totalSeconds));
  }, [activityBars]);

  const totalActiveDays = useMemo(() => {
    return activityBars.filter((b) => b.totalSeconds > 0).length;
  }, [activityBars]);

  const activeKey = hoveredDayKey || selectedDayKey;
  const inspectedBar = useMemo(() => {
    if (!activeKey) return null;
    return dayMap.get(activeKey) || null;
  }, [activeKey, dayMap]);

  const formatInspectedDate = (dateKey: string) => {
    const [y, m, d] = dateKey.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    const weekday = WEEKDAY_NAMES[dateObj.getDay()];
    return `${weekday}, ${d} ${MONTH_NAMES[m - 1]}`;
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Non-duplicative summary header */}
      <div className="flex items-center justify-between text-xs text-md-on-surface-variant font-medium">
        <span>
          <span className="font-bold text-md-on-surface">{totalActiveDays}</span> of 7 days active this week
        </span>
      </div>

      {/* 7-Day Focus Distribution Bar Chart */}
      <div
        className="flex items-end justify-between gap-1.5 sm:gap-3 h-44 sm:h-52 pt-6 pb-2 px-1 sm:px-2 rounded-2xl bg-md-surface-container/30 border border-md-outline-variant/20 select-none"
        onMouseLeave={() => setHoveredDayKey(null)}
      >
        {activityBars.map((bar) => {
          const isToday = bar.key === todayKey;
          const isSelected = activeKey === bar.key;
          const heightPct = maxDaySeconds > 0 ? Math.round((bar.totalSeconds / maxDaySeconds) * 100) : 0;

          return (
            <button
              type="button"
              key={bar.key}
              onClick={() => setSelectedDayKey((prev) => (prev === bar.key ? null : bar.key))}
              onMouseEnter={() => setHoveredDayKey(bar.key)}
              className={clsx(
                'flex-1 h-full flex flex-col items-center justify-end gap-1.5 p-1 rounded-xl transition-all cursor-pointer group focus:outline-none',
                isSelected && 'bg-md-primary/10'
              )}
            >
              {/* Duration Label above Bar */}
              <div className="text-[10px] sm:text-xs font-bold tabular-nums min-h-[16px] text-center">
                {bar.totalSeconds > 0 ? (
                  <span className={clsx(isSelected ? 'text-md-primary font-extrabold' : 'text-md-on-surface-variant')}>
                    {formatCompactDuration(bar.totalSeconds)}
                  </span>
                ) : (
                  <span className="text-md-outline/30">—</span>
                )}
              </div>

              {/* Vertical Bar Track & Filled Progress */}
              <div
                className={clsx(
                  'w-full max-w-[32px] sm:max-w-[44px] flex-1 bg-md-surface-container-high rounded-xl overflow-hidden flex flex-col justify-end p-0.5 border transition-all',
                  isSelected
                    ? 'border-md-primary ring-1 ring-md-primary/30'
                    : isToday
                    ? 'border-md-primary/50'
                    : 'border-transparent'
                )}
              >
                <div
                  className={clsx(
                    'w-full rounded-lg transition-all duration-500 ease-out',
                    isSelected
                      ? 'bg-md-primary shadow-xs'
                      : isToday
                      ? 'bg-md-primary/90'
                      : bar.totalSeconds > 0
                      ? 'bg-md-primary/70 group-hover:bg-md-primary'
                      : 'bg-transparent'
                  )}
                  style={{ height: `${bar.totalSeconds > 0 ? Math.max(8, heightPct) : 0}%` }}
                />
              </div>

              {/* Day Label & Date at Bottom */}
              <div className="flex flex-col items-center leading-none gap-0.5 pt-0.5">
                <span
                  className={clsx(
                    'text-[10px] sm:text-xs font-bold uppercase tracking-wider',
                    isToday ? 'text-md-primary font-extrabold' : 'text-md-on-surface-variant'
                  )}
                >
                  {bar.label}
                </span>
                <span
                  className={clsx(
                    'text-[10px] sm:text-[11px] tabular-nums',
                    isToday ? 'text-md-primary font-bold' : 'text-md-outline'
                  )}
                >
                  {bar.subLabel}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Minimal Status Inspector */}
      <div className="min-h-[28px] px-3 py-1.5 rounded-xl bg-md-surface-container/50 border border-md-outline-variant/20 flex items-center justify-between text-xs">
        {inspectedBar ? (
          <div className="flex items-center justify-between w-full">
            <span className="font-bold text-md-on-surface">
              {formatInspectedDate(inspectedBar.key)}
            </span>
            <span className="text-md-on-surface-variant">
              {inspectedBar.totalSeconds > 0 ? (
                <>
                  <strong className="text-md-primary font-bold">
                    {formatDurationHoursMins(inspectedBar.totalSeconds)}
                  </strong>{' '}
                  ({inspectedBar.sessionCount} {inspectedBar.sessionCount === 1 ? 'session' : 'sessions'})
                </>
              ) : (
                <span className="text-md-outline">No focus time logged</span>
              )}
            </span>
          </div>
        ) : (
          <span className="text-md-outline">
            Tap or hover any day to view details
          </span>
        )}
      </div>
    </div>
  );
};

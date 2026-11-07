import React, { useState, useMemo } from 'react';
import { ActivityBarStat } from '../../hooks/useStatistics';
import { formatDurationHoursMins, formatCompactDuration } from '../../utils/formatters';
import { WEEKDAY_NAMES, MONTH_NAMES, toDateKey } from '../../utils/dates';
import { Calendar as CalendarIcon, BarChart2 } from 'lucide-react';
import { ActivityInspectionCard } from './ActivityInspectionCard';
import { ActivityBarRow } from './ActivityBarRow';
import { clsx } from 'clsx';
import { getActivityIntensityStyle } from './activityUtils';

interface WeekActivityViewProps {
  activityBars: ActivityBarStat[];
}

export const WeekActivityView: React.FC<WeekActivityViewProps> = ({ activityBars }) => {
  const [displayMode, setDisplayMode] = useState<'calendar' | 'list'>('calendar');
  const [hoveredDayKey, setHoveredDayKey] = useState<string | null>(null);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);

  const todayKey = useMemo(() => toDateKey(new Date()), []);

  // Map of dateKey -> bar
  const dayMap = useMemo(() => {
    const map = new Map<string, ActivityBarStat>();
    activityBars.forEach((bar) => map.set(bar.key, bar));
    return map;
  }, [activityBars]);

  // Max focus seconds on any single day for intensity scaling
  const maxDaySeconds = useMemo(() => {
    return Math.max(1, ...activityBars.map((b) => b.totalSeconds));
  }, [activityBars]);

  // Peak day of the week
  const peakDay = useMemo(() => {
    let top: ActivityBarStat | null = null;
    for (const bar of activityBars) {
      if (bar.totalSeconds > 0 && (!top || bar.totalSeconds > top.totalSeconds)) {
        top = bar;
      }
    }
    return top;
  }, [activityBars]);

  // Active days count & total focus
  const totalActiveDays = useMemo(() => {
    return activityBars.filter((b) => b.totalSeconds > 0).length;
  }, [activityBars]);

  const totalFocusSeconds = useMemo(() => {
    return activityBars.reduce((acc, b) => acc + b.totalSeconds, 0);
  }, [activityBars]);

  // Currently inspected day (hovered/selected or null)
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
      {/* Top Toggle & Summary Subheader */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-md-on-surface-variant font-medium">
          <span className="font-bold text-md-on-surface">{totalActiveDays}</span> of 7 days active this week
          {totalFocusSeconds > 0 && (
            <span className="inline text-xs sm:text-sm text-md-outline">
              {' '}• {formatDurationHoursMins(totalFocusSeconds)} total
            </span>
          )}
        </div>

        {/* Calendar vs List Segmented Toggle */}
        <div className="inline-flex p-0.5 bg-md-surface-container rounded-xl border border-md-outline-variant/30 text-xs">
          <button
            type="button"
            onClick={() => setDisplayMode('calendar')}
            className={clsx(
              'px-2.5 py-1 rounded-lg font-semibold transition-all flex items-center gap-1.5',
              displayMode === 'calendar'
                ? 'bg-md-primary-container text-md-on-primary-container shadow-xs'
                : 'text-md-on-surface-variant hover:text-md-on-surface'
            )}
          >
            <CalendarIcon className="w-3.5 h-3.5" />
            <span>Calendar</span>
          </button>
          <button
            type="button"
            onClick={() => setDisplayMode('list')}
            className={clsx(
              'px-2.5 py-1 rounded-lg font-semibold transition-all flex items-center gap-1.5',
              displayMode === 'list'
                ? 'bg-md-primary-container text-md-on-primary-container shadow-xs'
                : 'text-md-on-surface-variant hover:text-md-on-surface'
            )}
          >
            <BarChart2 className="w-3.5 h-3.5" />
            <span>List</span>
          </button>
        </div>
      </div>

      {displayMode === 'calendar' ? (
        <div className="flex flex-col gap-2.5">
          {/* Weekday Header Row */}
          <div className="grid grid-cols-7 gap-1.5 sm:gap-2.5 text-center select-none">
            {activityBars.map((bar) => {
              const isToday = bar.key === todayKey;
              return (
                <div
                  key={`header-${bar.key}`}
                  className={clsx(
                    'text-[11px] font-bold uppercase tracking-wider py-1',
                    isToday ? 'text-md-primary font-extrabold' : 'text-md-on-surface-variant/80'
                  )}
                >
                  <span>{bar.label}</span>
                  {isToday && <span className="block text-[9px] font-normal lowercase tracking-normal">today</span>}
                </div>
              );
            })}
          </div>

          {/* 7-Column Calendar Grid */}
          <div
            className="grid grid-cols-7 gap-1.5 sm:gap-2.5"
            onMouseLeave={() => setHoveredDayKey(null)}
          >
            {activityBars.map((bar) => {
              const sec = bar.totalSeconds;
              const isSelected = selectedDayKey === bar.key;
              const isToday = bar.key === todayKey;

              return (
                <button
                  type="button"
                  key={bar.key}
                  onMouseEnter={() => setHoveredDayKey(bar.key)}
                  onClick={(e) => {
                    e.preventDefault();
                    setSelectedDayKey((prev) => (prev === bar.key ? null : bar.key));
                  }}
                  className={clsx(
                    'aspect-square min-h-[58px] sm:min-h-[82px] sm:aspect-auto p-1 sm:p-2.5 rounded-2xl border transition-all duration-150 flex flex-col items-center justify-center text-center sm:items-start sm:justify-between sm:text-left cursor-pointer group select-none relative',
                    getActivityIntensityStyle(sec, maxDaySeconds, isSelected),
                    isToday && !isSelected && 'ring-2 ring-md-primary/60 border-md-primary/40'
                  )}
                  aria-label={`${bar.label} ${bar.subLabel}: ${sec > 0 ? formatDurationHoursMins(sec) : 'No focus'}`}
                >
                  {/* Mobile: Date number, Today badge, and compact duration */}
                  <div className="flex sm:hidden flex-col items-center justify-center w-full gap-0.5">
                    {isToday && (
                      <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-md-primary text-white dark:text-md-on-primary leading-none tracking-tight">
                        TODAY
                      </span>
                    )}
                    <span className={clsx("text-xs font-bold leading-none", isToday && "text-md-primary font-extrabold")}>
                      {bar.subLabel}
                    </span>
                    {sec > 0 ? (
                      <span className="text-[10px] font-bold text-md-on-surface truncate leading-tight mt-0.5">
                        {formatCompactDuration(sec)}
                      </span>
                    ) : (
                      <span className="text-[9px] opacity-30 leading-none mt-0.5">—</span>
                    )}
                  </div>

                  {/* Desktop: Top date number with today badge */}
                  <div className="hidden sm:flex items-center justify-between w-full">
                    <span className="text-sm font-bold leading-none">
                      {bar.subLabel}
                    </span>
                    {isToday && (
                      <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-md-primary/20 text-md-primary leading-none">
                        TODAY
                      </span>
                    )}
                  </div>

                  {/* Desktop: Bottom Duration & Session count */}
                  {sec > 0 ? (
                    <div className="hidden sm:flex flex-col w-full mt-2">
                      <span className="text-xs font-extrabold truncate leading-tight">
                        {formatDurationHoursMins(sec)}
                      </span>
                      {bar.sessionCount > 0 && (
                        <span className="text-[10px] opacity-75 truncate leading-tight mt-0.5">
                          {bar.sessionCount} {bar.sessionCount === 1 ? 'session' : 'sessions'}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="hidden sm:block text-[11px] opacity-25 mt-2">
                      —
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Dynamic Day Inspector Bar */}
          <ActivityInspectionCard
            inspectedBar={inspectedBar}
            peakDay={peakDay}
            formatInspectedDate={formatInspectedDate}
          />
        </div>
      ) : (
        /* List / Bars View Mode */
        <div className="flex flex-col gap-2.5">
          {activityBars.map((bar) => {
            const isToday = bar.key === todayKey;
            return (
              <ActivityBarRow
                key={bar.key}
                label={`${bar.label} ${bar.subLabel || ''}`.trim()}
                badge={isToday ? <span className="text-[10px] text-md-primary font-semibold">Today</span> : undefined}
                totalSeconds={bar.totalSeconds}
                sessionCount={bar.sessionCount}
                maxSeconds={maxDaySeconds}
                isHighlighted={isToday}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

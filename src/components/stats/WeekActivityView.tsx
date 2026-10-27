import React, { useState, useMemo } from 'react';
import { ActivityBarStat } from '../../hooks/useStatistics';
import { formatDurationHoursMins } from '../../utils/formatters';
import { WEEKDAY_NAMES, MONTH_NAMES, toDateKey } from '../../utils/dates';
import { Calendar as CalendarIcon, BarChart2 } from 'lucide-react';
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
            <span className="hidden sm:inline text-md-outline">
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
                    'aspect-square sm:aspect-auto sm:min-h-[82px] p-1.5 sm:p-2.5 rounded-2xl border transition-all duration-150 flex flex-col items-center justify-center text-center sm:items-start sm:justify-between sm:text-left cursor-pointer group select-none relative',
                    getActivityIntensityStyle(sec, maxDaySeconds, isSelected),
                    isToday && !isSelected && 'ring-2 ring-md-primary/30'
                  )}
                  aria-label={`${bar.label} ${bar.subLabel}: ${sec > 0 ? formatDurationHoursMins(sec) : 'No focus'}`}
                >
                  {/* Mobile: Centered date number and activity indicator dot */}
                  <div className="flex sm:hidden flex-col items-center justify-center">
                    <span className="text-xs font-bold leading-none">
                      {bar.subLabel}
                    </span>
                    {sec > 0 ? (
                      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-85 mt-1" />
                    ) : (
                      <span className="text-[10px] opacity-30 mt-0.5 leading-none">—</span>
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
          <div className="mt-2 p-3 rounded-2xl bg-md-surface-container/50 border border-md-outline-variant/20 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs">
            {inspectedBar ? (
              <>
                <div className="font-semibold text-md-on-surface">
                  📅 {formatInspectedDate(inspectedBar.key)}
                </div>
                <div className="font-medium text-md-on-surface-variant">
                  {inspectedBar.totalSeconds > 0 ? (
                    <span>
                      <strong className="text-md-primary font-bold">
                        {formatDurationHoursMins(inspectedBar.totalSeconds)}
                      </strong>{' '}
                      focused across {inspectedBar.sessionCount}{' '}
                      {inspectedBar.sessionCount === 1 ? 'session' : 'sessions'}
                    </span>
                  ) : (
                    <span>No focus sessions logged</span>
                  )}
                </div>
              </>
            ) : peakDay ? (
              <>
                <div className="font-semibold text-md-on-surface">
                  🏆 Peak Day:{' '}
                  <span className="text-md-primary font-bold">
                    {formatInspectedDate(peakDay.key)}
                  </span>
                </div>
                <div className="text-md-on-surface-variant font-medium">
                  {formatDurationHoursMins(peakDay.totalSeconds)} focused ({peakDay.sessionCount}{' '}
                  {peakDay.sessionCount === 1 ? 'session' : 'sessions'})
                </div>
              </>
            ) : (
              <div className="text-md-outline">
                Hover or tap any day to inspect focus duration.
              </div>
            )}
          </div>
        </div>
      ) : (
        /* List / Bars View Mode */
        <div className="flex flex-col gap-2.5">
          {activityBars.map((bar) => {
            const widthPct = maxDaySeconds > 0 ? Math.min(100, Math.round((bar.totalSeconds / maxDaySeconds) * 100)) : 0;
            const hasHours = bar.totalSeconds > 0;
            const isToday = bar.key === todayKey;

            return (
              <div
                key={bar.key}
                className={clsx(
                  'flex items-center gap-3 p-3 rounded-2xl transition-all',
                  isToday ? 'bg-md-primary/5 border border-md-primary/20' : 'bg-md-surface-container/60 hover:bg-md-surface-container'
                )}
              >
                <div className="w-24 sm:w-28 shrink-0 flex flex-col">
                  <span className={clsx('text-xs font-bold truncate', isToday ? 'text-md-primary' : 'text-md-on-surface')}>
                    {bar.label} {bar.subLabel}
                  </span>
                  {isToday && (
                    <span className="text-[10px] text-md-primary font-semibold">Today</span>
                  )}
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
          })}
        </div>
      )}
    </div>
  );
};

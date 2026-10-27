import React, { useState, useMemo } from 'react';
import { ActivityBarStat } from '../../hooks/useStatistics';
import { formatDurationHoursMins } from '../../utils/formatters';
import { Calendar as CalendarIcon, BarChart2, Award } from 'lucide-react';
import { clsx } from 'clsx';
import { getActivityIntensityStyle } from './activityUtils';

interface AllTimeActivityViewProps {
  activityBars: ActivityBarStat[];
}

export const AllTimeActivityView: React.FC<AllTimeActivityViewProps> = ({ activityBars }) => {
  const [displayMode, setDisplayMode] = useState<'calendar' | 'list'>('calendar');
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Max focus seconds across all items for intensity scaling
  const maxSeconds = useMemo(() => {
    return Math.max(1, ...activityBars.map((b) => b.totalSeconds));
  }, [activityBars]);

  // Peak interval
  const peakItem = useMemo(() => {
    let top: ActivityBarStat | null = null;
    for (const bar of activityBars) {
      if (bar.totalSeconds > 0 && (!top || bar.totalSeconds > top.totalSeconds)) {
        top = bar;
      }
    }
    return top;
  }, [activityBars]);

  // Total active intervals count & total focus
  const totalActiveIntervals = useMemo(() => {
    return activityBars.filter((b) => b.totalSeconds > 0).length;
  }, [activityBars]);

  const totalFocusSeconds = useMemo(() => {
    return activityBars.reduce((acc, b) => acc + b.totalSeconds, 0);
  }, [activityBars]);

  // Inspected item
  const activeKey = hoveredKey || selectedKey;
  const inspectedBar = useMemo(() => {
    if (!activeKey) return null;
    return activityBars.find((b) => b.key === activeKey) || null;
  }, [activeKey, activityBars]);

  const formatItemTitle = (bar: ActivityBarStat) => {
    if (bar.subLabel) {
      return `${bar.label} ${bar.subLabel}`;
    }
    return bar.label;
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Top Toggle & Summary Subheader */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-md-on-surface-variant font-medium">
          <span className="font-bold text-md-on-surface">{totalActiveIntervals}</span> active intervals
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
            <span>Grid</span>
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
          {/* Calendar-Style Grid */}
          <div
            className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1.5 sm:gap-2.5"
            onMouseLeave={() => setHoveredKey(null)}
          >
            {activityBars.map((bar) => {
              const sec = bar.totalSeconds;
              const isSelected = selectedKey === bar.key;

              return (
                <button
                  type="button"
                  key={bar.key}
                  onMouseEnter={() => setHoveredKey(bar.key)}
                  onClick={(e) => {
                    e.preventDefault();
                    setSelectedKey((prev) => (prev === bar.key ? null : bar.key));
                  }}
                  className={clsx(
                    'aspect-auto min-h-[72px] sm:min-h-[82px] p-2 sm:p-2.5 rounded-2xl border transition-all duration-150 flex flex-col justify-between text-left cursor-pointer group select-none relative',
                    getActivityIntensityStyle(sec, maxSeconds, isSelected)
                  )}
                  aria-label={`${formatItemTitle(bar)}: ${sec > 0 ? formatDurationHoursMins(sec) : 'No focus'}`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-xs sm:text-sm font-bold leading-none">
                      {bar.label}
                    </span>
                    {bar.subLabel && (
                      <span className="text-[10px] opacity-70">
                        {bar.subLabel}
                      </span>
                    )}
                  </div>

                  {sec > 0 ? (
                    <div className="flex flex-col w-full mt-2">
                      <span className="text-xs sm:text-sm font-extrabold truncate leading-tight">
                        {formatDurationHoursMins(sec)}
                      </span>
                      {bar.sessionCount > 0 && (
                        <span className="text-[10px] opacity-75 truncate leading-tight mt-0.5">
                          {bar.sessionCount} {bar.sessionCount === 1 ? 'session' : 'sessions'}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="text-[11px] opacity-25 mt-2">
                      —
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Dynamic Inspector Bar */}
          <div className="mt-2 p-3 rounded-2xl bg-md-surface-container/50 border border-md-outline-variant/20 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs">
            {inspectedBar ? (
              <>
                <div className="font-semibold text-md-on-surface">
                  {formatItemTitle(inspectedBar)}
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
                    <span>No focus recorded</span>
                  )}
                </div>
              </>
            ) : peakItem ? (
              <>
                <div className="font-semibold text-md-on-surface flex items-center gap-1.5">
                  <Award className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span>
                    Peak Interval:{' '}
                    <span className="text-md-primary font-bold">
                      {formatItemTitle(peakItem)}
                    </span>
                  </span>
                </div>
                <div className="text-md-on-surface-variant font-medium">
                  {formatDurationHoursMins(peakItem.totalSeconds)} focused ({peakItem.sessionCount}{' '}
                  {peakItem.sessionCount === 1 ? 'session' : 'sessions'})
                </div>
              </>
            ) : (
              <div className="text-md-outline">
                Hover or tap any interval to inspect focus duration.
              </div>
            )}
          </div>
        </div>
      ) : (
        /* List View Mode */
        <div className="flex flex-col gap-2.5">
          {activityBars.map((bar) => {
            const widthPct = maxSeconds > 0 ? Math.min(100, Math.round((bar.totalSeconds / maxSeconds) * 100)) : 0;
            const hasHours = bar.totalSeconds > 0;

            return (
              <div
                key={bar.key}
                className="flex items-center gap-3 p-3 rounded-2xl bg-md-surface-container/60 hover:bg-md-surface-container transition-all"
              >
                <div className="w-28 sm:w-32 shrink-0 flex flex-col">
                  <span className="text-xs font-bold text-md-on-surface truncate">
                    {formatItemTitle(bar)}
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

import React, { useState, useMemo } from 'react';
import { ActivityBarStat } from '../../hooks/useStatistics';
import { formatDurationHoursMins } from '../../utils/formatters';
import { Calendar as CalendarIcon, BarChart2 } from 'lucide-react';
import { ActivityInspectionCard } from './ActivityInspectionCard';
import { ActivityBarRow } from './ActivityBarRow';
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
          <ActivityInspectionCard
            inspectedBar={inspectedBar}
            peakDay={peakItem}
            formatInspectedDate={(key) => inspectedBar ? formatItemTitle(inspectedBar) : peakItem ? formatItemTitle(peakItem) : key}
            peakLabel="Peak Interval"
            noDataText="No focus recorded"
            emptyPrompt="Hover or tap any interval to inspect focus duration."
          />
        </div>
      ) : (
        /* List View Mode */
        <div className="flex flex-col gap-2.5">
          {activityBars.map((bar) => (
            <ActivityBarRow
              key={bar.key}
              label={formatItemTitle(bar)}
              totalSeconds={bar.totalSeconds}
              sessionCount={bar.sessionCount}
              maxSeconds={maxSeconds}
            />
          ))}
        </div>
      )}
    </div>
  );
};

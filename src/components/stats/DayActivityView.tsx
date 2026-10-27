import React, { useState, useMemo } from 'react';
import { ActivityBarStat } from '../../hooks/useStatistics';
import { formatDurationHoursMins } from '../../utils/formatters';
import { Grid, Clock } from 'lucide-react';
import { clsx } from 'clsx';
import { getActivityIntensityStyle } from './activityUtils';

interface DayActivityViewProps {
  activityBars: ActivityBarStat[];
}

export const DayActivityView: React.FC<DayActivityViewProps> = ({ activityBars }) => {
  const [displayMode, setDisplayMode] = useState<'grid' | 'timeline'>('grid');
  const [hoveredHourKey, setHoveredHourKey] = useState<string | null>(null);
  const [selectedHourKey, setSelectedHourKey] = useState<string | null>(null);

  const currentHour = useMemo(() => new Date().getHours(), []);

  // Ensure 24 hours (00:00 to 23:00)
  const full24Hours = useMemo(() => {
    const barMap = new Map<number, ActivityBarStat>();
    activityBars.forEach((bar) => {
      // key format: 'hour-X' or parse label 'XX:00'
      const match = bar.key.match(/hour-(\d+)/) || bar.label.match(/^(\d+):/);
      const h = match ? parseInt(match[1], 10) : NaN;
      if (!isNaN(h)) {
        barMap.set(h, bar);
      }
    });

    return Array.from({ length: 24 }, (_, h) => {
      const existing = barMap.get(h);
      if (existing) return existing;
      return {
        key: `hour-${h}`,
        label: `${h.toString().padStart(2, '0')}:00`,
        totalSeconds: 0,
        hours: 0,
        sessionCount: 0,
      };
    });
  }, [activityBars]);

  // Max focus seconds in any single hour
  const maxHourSeconds = useMemo(() => {
    return Math.max(1, ...full24Hours.map((b) => b.totalSeconds));
  }, [full24Hours]);

  // Peak hour
  const peakHour = useMemo(() => {
    let top: ActivityBarStat | null = null;
    for (const bar of full24Hours) {
      if (bar.totalSeconds > 0 && (!top || bar.totalSeconds > top.totalSeconds)) {
        top = bar;
      }
    }
    return top;
  }, [full24Hours]);

  // Total active hours and total focus
  const activeHoursCount = useMemo(() => {
    return full24Hours.filter((b) => b.totalSeconds > 0).length;
  }, [full24Hours]);

  const totalFocusSeconds = useMemo(() => {
    return full24Hours.reduce((acc, b) => acc + b.totalSeconds, 0);
  }, [full24Hours]);

  // Inspected hour
  const activeKey = hoveredHourKey || selectedHourKey;
  const inspectedBar = useMemo(() => {
    if (!activeKey) return null;
    return full24Hours.find((b) => b.key === activeKey) || null;
  }, [activeKey, full24Hours]);

  const formatHourSpan = (hourLabel: string) => {
    const h = parseInt(hourLabel.split(':')[0], 10);
    const nextH = (h + 1) % 24;
    return `${h.toString().padStart(2, '0')}:00 – ${nextH.toString().padStart(2, '0')}:00`;
  };

  // Filtered active hours for timeline view
  const activeTimelineBars = useMemo(() => {
    return full24Hours.filter((b) => b.totalSeconds > 0);
  }, [full24Hours]);

  return (
    <div className="flex flex-col gap-4">
      {/* Top Toggle & Summary Subheader */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-md-on-surface-variant font-medium">
          <span className="font-bold text-md-on-surface">{activeHoursCount}</span> of 24 hours with focus activity
          {totalFocusSeconds > 0 && (
            <span className="hidden sm:inline text-md-outline">
              {' '}• {formatDurationHoursMins(totalFocusSeconds)} total
            </span>
          )}
        </div>

        {/* Grid vs Timeline Segmented Toggle */}
        <div className="inline-flex p-0.5 bg-md-surface-container rounded-xl border border-md-outline-variant/30 text-xs">
          <button
            type="button"
            onClick={() => setDisplayMode('grid')}
            className={clsx(
              'px-2.5 py-1 rounded-lg font-semibold transition-all flex items-center gap-1.5',
              displayMode === 'grid'
                ? 'bg-md-primary-container text-md-on-primary-container shadow-xs'
                : 'text-md-on-surface-variant hover:text-md-on-surface'
            )}
          >
            <Grid className="w-3.5 h-3.5" />
            <span>Grid</span>
          </button>
          <button
            type="button"
            onClick={() => setDisplayMode('timeline')}
            className={clsx(
              'px-2.5 py-1 rounded-lg font-semibold transition-all flex items-center gap-1.5',
              displayMode === 'timeline'
                ? 'bg-md-primary-container text-md-on-primary-container shadow-xs'
                : 'text-md-on-surface-variant hover:text-md-on-surface'
            )}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Timeline</span>
          </button>
        </div>
      </div>

      {displayMode === 'grid' ? (
        <div className="flex flex-col gap-2.5">
          {/* 24-Hour Calendar-Style Matrix: 6 cols on desktop, 4 cols on mobile */}
          <div
            className="grid grid-cols-4 sm:grid-cols-6 gap-1.5 sm:gap-2.5"
            onMouseLeave={() => setHoveredHourKey(null)}
          >
            {full24Hours.map((bar, idx) => {
              const sec = bar.totalSeconds;
              const isSelected = selectedHourKey === bar.key;
              const isCurrent = idx === currentHour;

              return (
                <button
                  type="button"
                  key={bar.key}
                  onMouseEnter={() => setHoveredHourKey(bar.key)}
                  onClick={(e) => {
                    e.preventDefault();
                    setSelectedHourKey((prev) => (prev === bar.key ? null : bar.key));
                  }}
                  className={clsx(
                    'aspect-square sm:aspect-auto sm:min-h-[68px] p-1.5 sm:p-2.5 rounded-2xl border transition-all duration-150 flex flex-col items-center justify-center text-center sm:items-start sm:justify-between sm:text-left cursor-pointer group select-none relative',
                    getActivityIntensityStyle(sec, maxHourSeconds, isSelected),
                    isCurrent && !isSelected && 'ring-2 ring-md-primary/30'
                  )}
                  aria-label={`${bar.label}: ${sec > 0 ? formatDurationHoursMins(sec) : 'No focus'}`}
                >
                  {/* Mobile: Centered hour & indicator dot */}
                  <div className="flex sm:hidden flex-col items-center justify-center">
                    <span className="text-[11px] font-bold leading-none">
                      {bar.label.slice(0, 2)}
                      <span className="text-[9px] opacity-70">h</span>
                    </span>
                    {sec > 0 ? (
                      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-85 mt-1" />
                    ) : (
                      <span className="text-[10px] opacity-25 mt-0.5 leading-none">—</span>
                    )}
                  </div>

                  {/* Desktop: Top hour label */}
                  <div className="hidden sm:flex items-center justify-between w-full">
                    <span className="text-xs font-bold leading-none">
                      {bar.label}
                    </span>
                    {isCurrent && (
                      <span className="w-1.5 h-1.5 rounded-full bg-md-primary animate-pulse" title="Current Hour" />
                    )}
                  </div>

                  {/* Desktop: Bottom Duration & Session count */}
                  {sec > 0 ? (
                    <div className="hidden sm:flex flex-col w-full mt-1.5">
                      <span className="text-xs font-extrabold truncate leading-tight">
                        {formatDurationHoursMins(sec)}
                      </span>
                      {bar.sessionCount > 0 && (
                        <span className="text-[9px] opacity-75 truncate leading-tight mt-0.5">
                          {bar.sessionCount} {bar.sessionCount === 1 ? 'session' : 'sessions'}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="hidden sm:block text-[11px] opacity-20 mt-1.5">
                      —
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Dynamic Hour Inspector Bar */}
          <div className="mt-2 p-3 rounded-2xl bg-md-surface-container/50 border border-md-outline-variant/20 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs">
            {inspectedBar ? (
              <>
                <div className="font-semibold text-md-on-surface">
                  ⏰ {formatHourSpan(inspectedBar.label)}
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
                    <span>No focus recorded in this hour</span>
                  )}
                </div>
              </>
            ) : peakHour ? (
              <>
                <div className="font-semibold text-md-on-surface">
                  🏆 Peak Focus Hour:{' '}
                  <span className="text-md-primary font-bold">
                    {formatHourSpan(peakHour.label)}
                  </span>
                </div>
                <div className="text-md-on-surface-variant font-medium">
                  {formatDurationHoursMins(peakHour.totalSeconds)} focused ({peakHour.sessionCount}{' '}
                  {peakHour.sessionCount === 1 ? 'session' : 'sessions'})
                </div>
              </>
            ) : (
              <div className="text-md-outline">
                Hover or tap any hour to inspect focus duration.
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Timeline View Mode */
        <div className="flex flex-col gap-2.5">
          {activeTimelineBars.length === 0 ? (
            <div className="text-center py-8 text-xs text-md-outline">
              No active focus hours logged for this day.
            </div>
          ) : (
            activeTimelineBars.map((bar) => {
              const widthPct = maxHourSeconds > 0 ? Math.min(100, Math.round((bar.totalSeconds / maxHourSeconds) * 100)) : 0;
              const hasHours = bar.totalSeconds > 0;

              return (
                <div
                  key={bar.key}
                  className="flex items-center gap-3 p-3 rounded-2xl bg-md-surface-container/60 hover:bg-md-surface-container transition-all"
                >
                  <div className="w-28 sm:w-32 shrink-0 flex flex-col">
                    <span className="text-xs font-bold text-md-on-surface truncate">
                      {formatHourSpan(bar.label)}
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
            })
          )}
        </div>
      )}
    </div>
  );
};

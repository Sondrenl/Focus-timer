import React, { useState, useMemo } from 'react';
import { ActivityBarStat } from '../../hooks/useStatistics';
import { formatDurationHoursMins } from '../../utils/formatters';
import { Award, Eye } from 'lucide-react';
import { clsx } from 'clsx';
import { getActivityIntensityStyle } from './activityUtils';

interface DayActivityViewProps {
  activityBars: ActivityBarStat[];
}

export const DayActivityView: React.FC<DayActivityViewProps> = ({ activityBars }) => {
  const [hoveredHourKey, setHoveredHourKey] = useState<string | null>(null);
  const [selectedHourKey, setSelectedHourKey] = useState<string | null>(null);
  const [showAllHours, setShowAllHours] = useState<boolean>(false);

  const currentHour = useMemo(() => new Date().getHours(), []);

  // Ensure all 24 hours (00:00 to 23:00) are mapped
  const full24Hours = useMemo(() => {
    const barMap = new Map<number, ActivityBarStat>();
    activityBars.forEach((bar) => {
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

  // Max focus seconds in any single hour for intensity scaling
  const maxHourSeconds = useMemo(() => {
    return Math.max(1, ...full24Hours.map((b) => b.totalSeconds));
  }, [full24Hours]);

  // Peak focus hour
  const peakHour = useMemo(() => {
    let top: ActivityBarStat | null = null;
    for (const bar of full24Hours) {
      if (bar.totalSeconds > 0 && (!top || bar.totalSeconds > top.totalSeconds)) {
        top = bar;
      }
    }
    return top;
  }, [full24Hours]);

  // Active hours count and total focus duration
  const activeHours = useMemo(() => {
    return full24Hours.filter((b) => b.totalSeconds > 0);
  }, [full24Hours]);

  const activeHoursCount = activeHours.length;

  const totalFocusSeconds = useMemo(() => {
    return full24Hours.reduce((acc, b) => acc + b.totalSeconds, 0);
  }, [full24Hours]);

  // Inspected hour (hovered or selected)
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

  // Rows displayed in the breakdown list below the ribbon
  const displayedBars = showAllHours ? full24Hours : activeHours;

  return (
    <div className="flex flex-col gap-3.5">
      {/* Top Summary & Toggle Subheader */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-md-on-surface-variant font-medium">
          <span className="font-bold text-md-on-surface">{activeHoursCount}</span> active{' '}
          {activeHoursCount === 1 ? 'hour' : 'hours'}
          {totalFocusSeconds > 0 && (
            <span className="text-md-outline">
              {' '}• {formatDurationHoursMins(totalFocusSeconds)} total
            </span>
          )}
        </div>

        {activeHoursCount > 0 && activeHoursCount < 24 && (
          <button
            type="button"
            onClick={() => setShowAllHours((prev) => !prev)}
            className="text-xs font-semibold text-md-primary hover:text-md-primary/80 flex items-center gap-1 transition-colors py-1 px-2 rounded-lg hover:bg-md-primary/5 cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>{showAllHours ? 'Show Active Only' : 'Show All 24h'}</span>
          </button>
        )}
      </div>

      {/* Compact 24-Hour Activity Ribbon */}
      <div className="flex flex-col gap-1.5 p-3 rounded-2xl bg-md-surface-container/50 border border-md-outline-variant/20">
        <div
          className="grid grid-cols-[repeat(24,minmax(0,1fr))] gap-0.5 sm:gap-1 h-9 sm:h-11"
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
                  'h-full rounded sm:rounded-md border transition-all duration-150 flex flex-col items-center justify-center cursor-pointer group select-none relative',
                  getActivityIntensityStyle(sec, maxHourSeconds, isSelected),
                  isCurrent && !isSelected && 'ring-2 ring-md-primary/40'
                )}
                aria-label={`${bar.label}: ${sec > 0 ? formatDurationHoursMins(sec) : 'No focus'}`}
              >
                {isCurrent && (
                  <span
                    className="w-1 h-1 rounded-full bg-md-primary animate-pulse absolute top-1"
                    title="Current Hour"
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Landmark Hour Labels */}
        <div className="flex items-center justify-between px-0.5 text-[10px] text-md-on-surface-variant/70 font-medium select-none">
          <span>00:00</span>
          <span>04:00</span>
          <span>08:00</span>
          <span>12:00</span>
          <span>16:00</span>
          <span>20:00</span>
          <span>23:00</span>
        </div>
      </div>

      {/* Dynamic Hour Inspector Bar */}
      <div className="p-3 rounded-2xl bg-md-surface-container/50 border border-md-outline-variant/20 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs">
        {inspectedBar ? (
          <>
            <div className="font-semibold text-md-on-surface">
              {formatHourSpan(inspectedBar.label)}
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
            <div className="font-semibold text-md-on-surface flex items-center gap-1.5">
              <Award className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span>
                Peak Hour:{' '}
                <span className="text-md-primary font-bold">
                  {formatHourSpan(peakHour.label)}
                </span>
              </span>
            </div>
            <div className="text-md-on-surface-variant font-medium">
              {formatDurationHoursMins(peakHour.totalSeconds)} focused ({peakHour.sessionCount}{' '}
              {peakHour.sessionCount === 1 ? 'session' : 'sessions'})
            </div>
          </>
        ) : (
          <div className="text-md-outline">
            Hover or tap any hour segment to inspect focus duration.
          </div>
        )}
      </div>

      {/* Focus Breakdown List */}
      <div className="flex flex-col gap-2">
        {activeHoursCount === 0 && !showAllHours ? (
          <div className="text-center py-6 text-xs text-md-outline rounded-2xl bg-md-surface-container/30 border border-md-outline-variant/10">
            No focus sessions logged for this day.
          </div>
        ) : (
          displayedBars.map((bar) => {
            const isSelected = activeKey === bar.key;
            const widthPct = maxHourSeconds > 0 ? Math.min(100, Math.round((bar.totalSeconds / maxHourSeconds) * 100)) : 0;
            const hasHours = bar.totalSeconds > 0;

            return (
              <button
                type="button"
                key={bar.key}
                onClick={() => setSelectedHourKey((prev) => (prev === bar.key ? null : bar.key))}
                onMouseEnter={() => setHoveredHourKey(bar.key)}
                className={clsx(
                  'w-full flex items-center gap-3 p-2.5 sm:p-3 rounded-2xl transition-all cursor-pointer text-left',
                  isSelected
                    ? 'bg-md-primary/10 border border-md-primary/30 ring-1 ring-md-primary/20'
                    : 'bg-md-surface-container/60 hover:bg-md-surface-container border border-transparent'
                )}
              >
                <div className="w-28 sm:w-32 shrink-0 flex flex-col">
                  <span className="text-xs font-bold text-md-on-surface truncate">
                    {formatHourSpan(bar.label)}
                  </span>
                </div>

                <div className="flex-1 h-6 bg-md-surface-container-high rounded-xl overflow-hidden flex items-center p-1">
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
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};

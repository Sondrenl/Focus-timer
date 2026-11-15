import React, { useState, useMemo } from 'react';
import { ActivityBarStat } from '../../hooks/useStatistics';
import { formatDurationHoursMins, formatCompactDuration } from '../../utils/formatters';
import { clsx } from 'clsx';

interface AllTimeActivityViewProps {
  activityBars: ActivityBarStat[];
}

export const AllTimeActivityView: React.FC<AllTimeActivityViewProps> = ({ activityBars }) => {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const maxSeconds = useMemo(() => {
    return Math.max(1, ...activityBars.map((b) => b.totalSeconds));
  }, [activityBars]);

  const totalActiveIntervals = useMemo(() => {
    return activityBars.filter((b) => b.totalSeconds > 0).length;
  }, [activityBars]);

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

  if (activityBars.length === 0) {
    return (
      <div className="text-center py-8 text-xs text-md-outline">
        No historical focus data available.
      </div>
    );
  }

  const showMobileHorizontal = activityBars.length > 6;

  return (
    <div className="flex flex-col gap-4 min-w-0">
      {/* Non-duplicative summary header */}
      <div className="flex items-center justify-between text-xs text-md-on-surface-variant font-medium">
        <span>
          <span className="font-bold text-md-on-surface">{totalActiveIntervals}</span> of {activityBars.length} intervals active
        </span>
      </div>

      {showMobileHorizontal && (
        <div className="flex sm:hidden flex-col gap-2">
          {activityBars.map((bar) => {
            const widthPct = maxSeconds > 0 ? Math.round((bar.totalSeconds / maxSeconds) * 100) : 0;

            return (
              <div
                key={bar.key}
                className="px-3 py-2.5 rounded-2xl border bg-md-surface-container/40 border-md-outline-variant/20 flex items-center gap-3 min-w-0"
              >
                <div className="w-14 shrink-0 leading-tight">
                  <div className="text-xs font-bold text-md-on-surface-variant truncate">{bar.label}</div>
                  {bar.subLabel && (
                    <div className="text-[10px] text-md-outline tabular-nums">{bar.subLabel}</div>
                  )}
                </div>

                <div className="flex-1 min-w-0 h-2.5 bg-md-surface-container-high rounded-full overflow-hidden">
                  <div
                    className={clsx(
                      'h-full rounded-full transition-[width] duration-300 ease-out',
                      bar.totalSeconds > 0 ? 'bg-md-primary/80' : 'bg-transparent'
                    )}
                    style={{ width: `${bar.totalSeconds > 0 ? Math.max(6, widthPct) : 0}%` }}
                  />
                </div>

                <div className="w-[74px] shrink-0 text-right leading-tight">
                  {bar.totalSeconds > 0 ? (
                    <>
                      <div className="text-xs font-bold text-md-on-surface tabular-nums">
                        {formatCompactDuration(bar.totalSeconds)}
                      </div>
                      <div className="text-[10px] text-md-on-surface-variant font-medium tabular-nums">
                        {bar.sessionCount} {bar.sessionCount === 1 ? 'session' : 'sessions'}
                      </div>
                    </>
                  ) : (
                    <span className="text-xs text-md-outline/40 font-medium">—</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Progression Bar Chart */}
      <div className={clsx(showMobileHorizontal ? 'hidden sm:flex flex-col gap-4' : 'flex flex-col gap-4', 'min-w-0')}>
        <div
          className="flex items-end justify-between gap-1.5 sm:gap-3 h-44 sm:h-52 pt-6 pb-2 px-1 sm:px-2 rounded-2xl bg-md-surface-container/30 border border-md-outline-variant/20 select-none overflow-x-auto min-w-0"
          onMouseLeave={() => setHoveredKey(null)}
        >
          {activityBars.map((bar) => {
            const isSelected = activeKey === bar.key;
            const heightPct = maxSeconds > 0 ? Math.round((bar.totalSeconds / maxSeconds) * 100) : 0;

            return (
              <button
                type="button"
                key={bar.key}
                onClick={() => {
                  setSelectedKey((prev) => (prev === bar.key ? null : bar.key));
                  setHoveredKey(null);
                }}
                onMouseEnter={() => setHoveredKey(bar.key)}
                className="flex-1 min-w-[32px] sm:min-w-0 h-full flex flex-col items-center justify-end gap-1.5 p-1 rounded-xl cursor-pointer group focus:outline-none select-none touch-manipulation"
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
                    'w-full max-w-[36px] sm:max-w-[48px] flex-1 bg-md-surface-container-high rounded-xl overflow-hidden flex flex-col justify-end p-0.5 border',
                    isSelected ? 'border-md-primary ring-1 ring-md-primary/30' : 'border-transparent'
                  )}
                >
                  <div
                    className={clsx(
                      'w-full rounded-lg transition-[height] duration-300 ease-out',
                      isSelected
                        ? 'bg-md-primary'
                        : bar.totalSeconds > 0
                        ? 'bg-md-primary/75'
                        : 'bg-transparent'
                    )}
                    style={{ height: `${bar.totalSeconds > 0 ? Math.max(8, heightPct) : 0}%` }}
                  />
                </div>

                {/* Label */}
                <div className="flex flex-col items-center leading-none pt-0.5">
                  <span className="text-[10px] sm:text-xs font-bold text-md-on-surface-variant">
                    {bar.label}
                  </span>
                  {bar.subLabel && (
                    <span className="text-[9px] text-md-outline tabular-nums">
                      {bar.subLabel}
                    </span>
                  )}
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
                {formatItemTitle(inspectedBar)}
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
              Tap or hover any interval to view details
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

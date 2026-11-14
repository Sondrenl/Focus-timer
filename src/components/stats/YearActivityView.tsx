import React, { useState, useMemo } from 'react';
import { ActivityBarStat } from '../../hooks/useStatistics';
import { formatDurationHoursMins, formatCompactDuration } from '../../utils/formatters';
import { MONTH_NAMES } from '../../utils/dates';
import { clsx } from 'clsx';

interface YearActivityViewProps {
  activityBars: ActivityBarStat[];
}

export const YearActivityView: React.FC<YearActivityViewProps> = ({ activityBars }) => {
  const [hoveredMonthKey, setHoveredMonthKey] = useState<string | null>(null);
  const [selectedMonthKey, setSelectedMonthKey] = useState<string | null>(null);

  const currentMonthIdx = useMemo(() => new Date().getMonth(), []);

  // Ensure 12 months (Jan to Dec)
  const full12Months = useMemo(() => {
    const monthMap = new Map<number, ActivityBarStat>();
    activityBars.forEach((bar) => {
      const match = bar.key.match(/month-(\d+)/);
      const m = match ? parseInt(match[1], 10) : NaN;
      if (!isNaN(m)) {
        monthMap.set(m, bar);
      }
    });

    return Array.from({ length: 12 }, (_, i) => {
      const existing = monthMap.get(i);
      if (existing) return existing;
      return {
        key: `month-${i}`,
        label: MONTH_NAMES[i].slice(0, 3),
        totalSeconds: 0,
        hours: 0,
        sessionCount: 0,
      };
    });
  }, [activityBars]);

  const maxMonthSeconds = useMemo(() => {
    return Math.max(1, ...full12Months.map((b) => b.totalSeconds));
  }, [full12Months]);

  const activeMonthsCount = useMemo(() => {
    return full12Months.filter((b) => b.totalSeconds > 0).length;
  }, [full12Months]);

  // Aggregate into 4 quarters: Q1 (Jan-Mar), Q2 (Apr-Jun), Q3 (Jul-Sep), Q4 (Oct-Dec)
  const quarters = useMemo(() => {
    const qNames = [
      { name: 'Q1', span: 'Jan – Mar' },
      { name: 'Q2', span: 'Apr – Jun' },
      { name: 'Q3', span: 'Jul – Sep' },
      { name: 'Q4', span: 'Oct – Dec' },
    ];

    return qNames.map((q, qIdx) => {
      const mStart = qIdx * 3;
      const mEnd = mStart + 3;
      const qMonths = full12Months.slice(mStart, mEnd);
      const totalSec = qMonths.reduce((acc, m) => acc + m.totalSeconds, 0);
      const totalSes = qMonths.reduce((acc, m) => acc + m.sessionCount, 0);
      const activeMo = qMonths.filter((m) => m.totalSeconds > 0).length;

      return {
        ...q,
        totalSeconds: totalSec,
        sessionCount: totalSes,
        activeMonths: activeMo,
      };
    });
  }, [full12Months]);

  const maxQuarterSeconds = useMemo(() => {
    return Math.max(1, ...quarters.map((q) => q.totalSeconds));
  }, [quarters]);

  const activeKey = hoveredMonthKey || selectedMonthKey;
  const inspectedBar = useMemo(() => {
    if (!activeKey) return null;
    return full12Months.find((b) => b.key === activeKey) || null;
  }, [activeKey, full12Months]);

  const getFullMonthName = (key: string) => {
    const match = key.match(/month-(\d+)/);
    const m = match ? parseInt(match[1], 10) : NaN;
    if (!isNaN(m) && MONTH_NAMES[m]) {
      return MONTH_NAMES[m];
    }
    return key;
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Non-duplicative summary header */}
      <div className="flex items-center justify-between text-xs text-md-on-surface-variant font-medium">
        <span>
          <span className="font-bold text-md-on-surface">{activeMonthsCount}</span> of 12 months active
        </span>
      </div>

      {/* 12-Month Progression Bar Chart */}
      <div
        className="flex items-end justify-between gap-1 sm:gap-2 h-44 sm:h-52 pt-6 pb-2 px-1 sm:px-2 rounded-2xl bg-md-surface-container/30 border border-md-outline-variant/20 select-none overflow-x-auto"
        onMouseLeave={() => setHoveredMonthKey(null)}
      >
        {full12Months.map((bar, idx) => {
          const isCurrentMonth = idx === currentMonthIdx;
          const isSelected = activeKey === bar.key;
          const heightPct = maxMonthSeconds > 0 ? Math.round((bar.totalSeconds / maxMonthSeconds) * 100) : 0;

          return (
            <button
              type="button"
              key={bar.key}
              onClick={() => {
                setSelectedMonthKey((prev) => (prev === bar.key ? null : bar.key));
                setHoveredMonthKey(null);
              }}
              onMouseEnter={() => setHoveredMonthKey(bar.key)}
              className="flex-1 min-w-[20px] sm:min-w-0 h-full flex flex-col items-center justify-end gap-1.5 p-0.5 sm:p-1 rounded-xl cursor-pointer group focus:outline-none select-none touch-manipulation"
            >
              {/* Duration Label above Bar */}
              <div className="text-[9px] sm:text-[11px] font-bold tabular-nums min-h-[16px] text-center">
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
                  'w-full max-w-[28px] sm:max-w-[40px] flex-1 bg-md-surface-container-high rounded-xl overflow-hidden flex flex-col justify-end p-0.5 border',
                  isSelected
                    ? 'border-md-primary ring-1 ring-md-primary/30'
                    : isCurrentMonth
                    ? 'border-md-primary/50'
                    : 'border-transparent'
                )}
              >
                <div
                  className={clsx(
                    'w-full rounded-lg transition-[height] duration-300 ease-out',
                    isSelected
                      ? 'bg-md-primary'
                      : isCurrentMonth
                      ? 'bg-md-primary/90'
                      : bar.totalSeconds > 0
                      ? 'bg-md-primary/70'
                      : 'bg-transparent'
                  )}
                  style={{ height: `${bar.totalSeconds > 0 ? Math.max(8, heightPct) : 0}%` }}
                />
              </div>

              {/* Month Label */}
              <div className="flex flex-col items-center leading-none pt-0.5">
                <span
                  className={clsx(
                    'text-[10px] sm:text-xs font-bold uppercase tracking-wider',
                    isCurrentMonth ? 'text-md-primary font-extrabold' : 'text-md-on-surface-variant'
                  )}
                >
                  {bar.label}
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
              {getFullMonthName(inspectedBar.key)}
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
            Tap or hover any month to view details
          </span>
        )}
      </div>

      {/* Quarterly Trajectory (Q1, Q2, Q3, Q4) - zero shading! */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {quarters.map((q) => {
          const widthPct = maxQuarterSeconds > 0 ? Math.round((q.totalSeconds / maxQuarterSeconds) * 100) : 0;

          return (
            <div
              key={q.name}
              className="p-3 rounded-2xl bg-md-surface-container/40 border border-md-outline-variant/20 flex flex-col justify-between gap-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-md-on-surface">{q.name}</span>
                <span className="text-[10px] text-md-outline font-medium">{q.span}</span>
              </div>

              <div>
                <div className="text-sm font-extrabold text-md-on-surface tabular-nums">
                  {q.totalSeconds > 0 ? formatCompactDuration(q.totalSeconds) : '0m'}
                </div>
                <div className="text-[10px] text-md-on-surface-variant font-medium">
                  {q.sessionCount > 0 ? `${q.sessionCount} sessions` : '—'}
                </div>
              </div>

              {/* Proportional Volume Bar */}
              <div className="w-full h-1.5 bg-md-surface-container-highest/60 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-md-primary transition-all duration-500 ease-out"
                  style={{ width: `${Math.max(q.totalSeconds > 0 ? 8 : 0, widthPct)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

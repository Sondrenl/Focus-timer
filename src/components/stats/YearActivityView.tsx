import React, { useMemo } from 'react';
import { ActivityBarStat } from '../../hooks/useStatistics';
import { formatCompactDuration } from '../../utils/formatters';
import { MONTH_NAMES } from '../../utils/dates';
import { clsx } from 'clsx';

interface YearActivityViewProps {
  activityBars: ActivityBarStat[];
  isCurrentYear?: boolean;
}

export const YearActivityView: React.FC<YearActivityViewProps> = ({
  activityBars,
  isCurrentYear = true,
}) => {
  const currentMonthIdx = new Date().getMonth();

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

      return {
        ...q,
        totalSeconds: totalSec,
        sessionCount: totalSes,
      };
    });
  }, [full12Months]);

  const maxQuarterSeconds = useMemo(() => {
    return Math.max(1, ...quarters.map((q) => q.totalSeconds));
  }, [quarters]);

  return (
    <div className="flex flex-col gap-5 min-w-0">
      {/* Non-duplicative summary header */}
      <div className="flex items-center justify-between text-xs text-md-on-surface-variant font-medium">
        <span>
          <span className="font-bold text-md-on-surface">{activeMonthsCount}</span> of 12 months active
        </span>
      </div>

      {/* Quarterly Trajectory (Q1, Q2, Q3, Q4) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {quarters.map((q) => {
          const widthPct = maxQuarterSeconds > 0 ? Math.round((q.totalSeconds / maxQuarterSeconds) * 100) : 0;

          return (
            <div
              key={q.name}
              className="p-3 rounded-2xl bg-md-surface-container/40 border border-md-outline-variant/20 flex flex-col justify-between gap-2 min-w-0"
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-xs font-bold text-md-on-surface">{q.name}</span>
                <span className="text-[10px] text-md-outline font-medium truncate">{q.span}</span>
              </div>

              <div>
                <div className="text-sm font-extrabold text-md-on-surface tabular-nums">
                  {q.totalSeconds > 0 ? formatCompactDuration(q.totalSeconds) : '0m'}
                </div>
                <div className="text-[10px] text-md-on-surface-variant font-medium">
                  {q.sessionCount > 0 ? `${q.sessionCount} ${q.sessionCount === 1 ? 'session' : 'sessions'}` : '—'}
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

      {/* 12-Month Horizontal Progress Grid (spacious & readable on mobile and desktop) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {full12Months.map((bar, idx) => {
          const isCurrentMonth = isCurrentYear && idx === currentMonthIdx;
          const widthPct = maxMonthSeconds > 0 ? Math.round((bar.totalSeconds / maxMonthSeconds) * 100) : 0;

          return (
            <div
              key={bar.key}
              className={clsx(
                'px-3 py-2.5 rounded-2xl border flex items-center gap-3 min-w-0',
                isCurrentMonth
                  ? 'bg-md-primary/5 border-md-primary/30'
                  : 'bg-md-surface-container/40 border-md-outline-variant/20'
              )}
            >
              {/* Month Name */}
              <div className="w-10 shrink-0 flex items-center gap-1">
                <span
                  className={clsx(
                    'text-xs font-bold uppercase tracking-wider',
                    isCurrentMonth ? 'text-md-primary font-extrabold' : 'text-md-on-surface-variant'
                  )}
                >
                  {bar.label}
                </span>
              </div>

              {/* Horizontal Proportional Track */}
              <div className="flex-1 min-w-0 h-2.5 bg-md-surface-container-high rounded-full overflow-hidden">
                <div
                  className={clsx(
                    'h-full rounded-full transition-[width] duration-300 ease-out',
                    isCurrentMonth ? 'bg-md-primary' : bar.totalSeconds > 0 ? 'bg-md-primary/75' : 'bg-transparent'
                  )}
                  style={{ width: `${bar.totalSeconds > 0 ? Math.max(6, widthPct) : 0}%` }}
                />
              </div>

              {/* Duration & Session Count */}
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
    </div>
  );
};

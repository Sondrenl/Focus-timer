import React, { useState, useMemo } from 'react';
import { ActivityBarStat } from '../../hooks/useStatistics';
import { formatDurationHoursMins } from '../../utils/formatters';
import { MONTH_NAMES } from '../../utils/dates';
import { Calendar as CalendarIcon, PieChart, Award } from 'lucide-react';
import { clsx } from 'clsx';
import { getActivityIntensityStyle } from './activityUtils';

interface YearActivityViewProps {
  activityBars: ActivityBarStat[];
}

export const YearActivityView: React.FC<YearActivityViewProps> = ({ activityBars }) => {
  const [displayMode, setDisplayMode] = useState<'calendar' | 'quarters'>('calendar');
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

  // Max focus seconds in any single month
  const maxMonthSeconds = useMemo(() => {
    return Math.max(1, ...full12Months.map((b) => b.totalSeconds));
  }, [full12Months]);

  // Peak month
  const peakMonth = useMemo(() => {
    let top: ActivityBarStat | null = null;
    for (const bar of full12Months) {
      if (bar.totalSeconds > 0 && (!top || bar.totalSeconds > top.totalSeconds)) {
        top = bar;
      }
    }
    return top;
  }, [full12Months]);

  // Total active months and total focus
  const activeMonthsCount = useMemo(() => {
    return full12Months.filter((b) => b.totalSeconds > 0).length;
  }, [full12Months]);

  const totalFocusSeconds = useMemo(() => {
    return full12Months.reduce((acc, b) => acc + b.totalSeconds, 0);
  }, [full12Months]);

  // Inspected month
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

  // Group into 4 Quarters: Q1 (Jan-Mar), Q2 (Apr-Jun), Q3 (Jul-Sep), Q4 (Oct-Dec)
  const quarters = useMemo(() => {
    const qData: {
      quarter: string;
      label: string;
      totalSeconds: number;
      sessionCount: number;
      activeMonths: number;
    }[] = [
      { quarter: 'Q1', label: 'Jan – Mar', totalSeconds: 0, sessionCount: 0, activeMonths: 0 },
      { quarter: 'Q2', label: 'Apr – Jun', totalSeconds: 0, sessionCount: 0, activeMonths: 0 },
      { quarter: 'Q3', label: 'Jul – Sep', totalSeconds: 0, sessionCount: 0, activeMonths: 0 },
      { quarter: 'Q4', label: 'Oct – Dec', totalSeconds: 0, sessionCount: 0, activeMonths: 0 },
    ];

    full12Months.forEach((bar, idx) => {
      const qIdx = Math.floor(idx / 3);
      if (qData[qIdx]) {
        qData[qIdx].totalSeconds += bar.totalSeconds;
        qData[qIdx].sessionCount += bar.sessionCount;
        if (bar.totalSeconds > 0) qData[qIdx].activeMonths += 1;
      }
    });

    return qData;
  }, [full12Months]);

  const maxQuarterSeconds = useMemo(() => {
    return Math.max(1, ...quarters.map((q) => q.totalSeconds));
  }, [quarters]);

  return (
    <div className="flex flex-col gap-4">
      {/* Top Toggle & Summary Subheader */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-md-on-surface-variant font-medium">
          <span className="font-bold text-md-on-surface">{activeMonthsCount}</span> of 12 months active
          {totalFocusSeconds > 0 && (
            <span className="hidden sm:inline text-md-outline">
              {' '}• {formatDurationHoursMins(totalFocusSeconds)} total
            </span>
          )}
        </div>

        {/* Calendar vs Quarters Segmented Toggle */}
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
            <span>Months</span>
          </button>
          <button
            type="button"
            onClick={() => setDisplayMode('quarters')}
            className={clsx(
              'px-2.5 py-1 rounded-lg font-semibold transition-all flex items-center gap-1.5',
              displayMode === 'quarters'
                ? 'bg-md-primary-container text-md-on-primary-container shadow-xs'
                : 'text-md-on-surface-variant hover:text-md-on-surface'
            )}
          >
            <PieChart className="w-3.5 h-3.5" />
            <span>Quarters</span>
          </button>
        </div>
      </div>

      {displayMode === 'calendar' ? (
        <div className="flex flex-col gap-2.5">
          {/* 12-Month Calendar Grid: 4 cols on desktop, 3 cols on mobile */}
          <div
            className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 sm:gap-3"
            onMouseLeave={() => setHoveredMonthKey(null)}
          >
            {full12Months.map((bar, idx) => {
              const sec = bar.totalSeconds;
              const isSelected = selectedMonthKey === bar.key;
              const isCurrent = idx === currentMonthIdx;

              return (
                <button
                  type="button"
                  key={bar.key}
                  onMouseEnter={() => setHoveredMonthKey(bar.key)}
                  onClick={(e) => {
                    e.preventDefault();
                    setSelectedMonthKey((prev) => (prev === bar.key ? null : bar.key));
                  }}
                  className={clsx(
                    'aspect-auto min-h-[74px] sm:min-h-[88px] p-2 sm:p-3 rounded-2xl border transition-all duration-150 flex flex-col justify-between text-left cursor-pointer group select-none relative',
                    getActivityIntensityStyle(sec, maxMonthSeconds, isSelected),
                    isCurrent && !isSelected && 'ring-2 ring-md-primary/30'
                  )}
                  aria-label={`${MONTH_NAMES[idx]}: ${sec > 0 ? formatDurationHoursMins(sec) : 'No focus'}`}
                >
                  {/* Top Month Header */}
                  <div className="flex items-center justify-between w-full">
                    <span className="text-xs sm:text-sm font-bold leading-none">
                      <span className="sm:hidden">{bar.label}</span>
                      <span className="hidden sm:inline">{MONTH_NAMES[idx]}</span>
                    </span>
                    {isCurrent && (
                      <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-md-primary/20 text-md-primary leading-none">
                        NOW
                      </span>
                    )}
                  </div>

                  {/* Bottom Duration & Session count */}
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

          {/* Dynamic Month Inspector Bar */}
          <div className="mt-2 p-3 rounded-2xl bg-md-surface-container/50 border border-md-outline-variant/20 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs">
            {inspectedBar ? (
              <>
                <div className="font-semibold text-md-on-surface">
                  {getFullMonthName(inspectedBar.key)}
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
                    <span>No focus recorded in this month</span>
                  )}
                </div>
              </>
            ) : peakMonth ? (
              <>
                <div className="font-semibold text-md-on-surface flex items-center gap-1.5">
                  <Award className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span>
                    Peak Month:{' '}
                    <span className="text-md-primary font-bold">
                      {getFullMonthName(peakMonth.key)}
                    </span>
                  </span>
                </div>
                <div className="text-md-on-surface-variant font-medium">
                  {formatDurationHoursMins(peakMonth.totalSeconds)} focused ({peakMonth.sessionCount}{' '}
                  {peakMonth.sessionCount === 1 ? 'session' : 'sessions'})
                </div>
              </>
            ) : (
              <div className="text-md-outline">
                Hover or tap any month to inspect focus duration.
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Quarters Mode */
        <div className="flex flex-col gap-2.5">
          {quarters.map((q) => {
            const widthPct = maxQuarterSeconds > 0 ? Math.min(100, Math.round((q.totalSeconds / maxQuarterSeconds) * 100)) : 0;
            const hasHours = q.totalSeconds > 0;

            return (
              <div
                key={q.quarter}
                className="flex items-center gap-3 p-3.5 rounded-2xl bg-md-surface-container/60 hover:bg-md-surface-container transition-all"
              >
                <div className="w-28 sm:w-32 shrink-0 flex flex-col">
                  <span className="text-xs font-bold text-md-on-surface truncate">
                    {q.quarter}
                  </span>
                  <span className="text-[11px] text-md-outline truncate">
                    {q.label}
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

                <div className="w-28 shrink-0 text-right flex flex-col items-end">
                  <span
                    className={clsx(
                      'text-xs font-bold tabular-nums',
                      hasHours ? 'text-md-on-surface' : 'text-md-outline'
                    )}
                  >
                    {hasHours ? formatDurationHoursMins(q.totalSeconds) : '0m'}
                  </span>
                  <span className="text-[10px] text-md-on-surface-variant">
                    {q.activeMonths} active {q.activeMonths === 1 ? 'month' : 'months'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { useStatistics, TimePeriodType } from '../../hooks/useStatistics';
import { Card } from '../ui/Card';
import {
  Clock,
  CheckCircle2,
  Coffee,
  Calendar,
  Tag as TagIcon,
  Award,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Sparkles,
} from 'lucide-react';
import { formatDurationHoursMins } from '../../utils/formatters';
import { DateRangeModal } from './DateRangeModal';
import { TagDistributionDonut } from './TagDistributionDonut';
import { clsx } from 'clsx';

export const StatisticsView: React.FC = () => {
  const {
    periodType,
    setPeriodType,
    periodLabel,
    customRange,
    setCustomRange,
    goToPrev,
    goToNext,
    goToToday,
    canGoNext,
    isCurrentPeriod,
    totalFocusSeconds,
    totalWorkCount,
    totalCoffeeCups,
    coffeeDailyAverage,
    coffeeElapsedDays,
    coffeePeakMetric,
    tagDistribution,
    activityBars,
    productiveMetric,
  } = useStatistics();

  const { syncWithCloud, auth } = useApp();

  useEffect(() => {
    if (auth.isAuthenticated && !auth.isSyncing) {
      syncWithCloud().catch(() => {});
    }
  }, [auth.isAuthenticated]);

  const [isCalendarModalOpen, setIsCalendarModalOpen] = useState(false);

  // Maximum seconds for scaling bar charts
  const maxSeconds = Math.max(1, ...activityBars.map((b) => b.totalSeconds));

  // Custom placed on the far right as requested
  const periodOptions: { type: TimePeriodType; label: string }[] = [
    { type: 'day', label: 'Day' },
    { type: 'week', label: 'Week' },
    { type: 'month', label: 'Month' },
    { type: 'year', label: 'Year' },
    { type: 'all', label: 'All Time' },
    { type: 'custom', label: 'Custom' },
  ];

  // Desktop min-width for activity breakdown horizontal scrolling
  const chartMinWidth =
    periodType === 'month'
      ? Math.max(activityBars.length * 28, 680)
      : periodType === 'year' || periodType === 'all'
      ? Math.max(activityBars.length * 42, 480)
      : periodType === 'custom' && activityBars.length > 7
      ? activityBars.length * 40
      : undefined;

  return (
    <div className="w-full max-w-4xl mx-auto py-6 px-4 flex flex-col gap-6">
      {/* View Header */}
      <div>
        <h2 className="text-2xl font-bold text-md-on-surface">Statistics & Insights</h2>
      </div>

      {/* Welcome / Empty-state Banner */}
      {totalWorkCount === 0 && (
        <div className="p-4 rounded-2xl bg-md-surface-container-low border border-md-primary/20 flex items-start sm:items-center gap-3 text-xs text-md-on-surface shadow-xs">
          <div className="w-8 h-8 rounded-xl bg-md-primary/10 text-md-primary flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-md-primary" />
          </div>
          <div className="flex-1">
            <p className="font-bold text-md-on-surface">Ready to start logging focus?</p>
            <p className="text-md-on-surface-variant text-[11px] mt-0.5 leading-relaxed">
              Complete your first Pomodoro session to populate focus streaks, tag breakdown, and daily activity curves.
            </p>
          </div>
        </div>
      )}

      {/* 1. Time Period Selector & Period Navigator */}
      {/* Desktop Layout (md and up) */}
      <div className="hidden md:flex flex-row items-center justify-between gap-4 p-4 rounded-3xl bg-md-surface-container-low border border-md-outline-variant/30 shadow-xs">
        {/* Period Type Segmented Buttons */}
        <div className="inline-flex p-1 bg-md-surface-container rounded-2xl border border-md-outline-variant/30 overflow-x-auto">
          {periodOptions.map((opt) => {
            const isActive = periodType === opt.type;
            return (
              <button
                key={opt.type}
                onClick={() => {
                  setPeriodType(opt.type);
                  if (opt.type === 'custom') {
                    setIsCalendarModalOpen(true);
                  }
                }}
                className={clsx(
                  'px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all duration-200 select-none whitespace-nowrap',
                  isActive
                    ? 'bg-md-primary-container text-md-on-primary-container shadow-xs'
                    : 'text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-surface-container-high'
                )}
              >
                {opt.type === 'custom' ? (
                  <span className="flex items-center gap-1.5">
                    <CalendarDays className="w-3.5 h-3.5" />
                    Custom
                  </span>
                ) : (
                  opt.label
                )}
              </button>
            );
          })}
        </div>

        {/* Period Navigator Controls */}
        <div className="flex items-center justify-end gap-2">
          {periodType !== 'all' && periodType !== 'custom' && !isCurrentPeriod && (
            <button
              onClick={goToToday}
              className="px-2.5 py-1.5 rounded-xl text-xs font-semibold text-md-primary hover:bg-md-primary/10 transition-colors"
            >
              Today
            </button>
          )}

          <div className="flex items-center gap-1 bg-md-surface-container rounded-2xl p-1 border border-md-outline-variant/30">
            {periodType !== 'all' && periodType !== 'custom' && (
              <button
                onClick={goToPrev}
                className="p-1.5 rounded-xl text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-surface-container-high transition-colors"
                title="Previous period"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                if (periodType === 'custom') {
                  setIsCalendarModalOpen(true);
                }
              }}
              className={clsx(
                "px-3 text-xs font-bold text-md-on-surface whitespace-nowrap",
                periodType === 'custom' && "hover:text-md-primary underline decoration-dotted underline-offset-4 cursor-pointer"
              )}
            >
              {periodLabel}
            </button>

            {periodType !== 'all' && periodType !== 'custom' && (
              <button
                onClick={goToNext}
                disabled={!canGoNext}
                className={clsx(
                  "p-1.5 rounded-xl text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-surface-container-high transition-colors",
                  !canGoNext && "opacity-30 cursor-not-allowed pointer-events-none"
                )}
                title="Next period"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Layout (< md only - 3x2 grid & large touch navigator) */}
      <div className="flex md:hidden flex-col gap-3.5 p-4 rounded-3xl bg-md-surface-container-low border border-md-outline-variant/30 shadow-xs">
        <div className="grid grid-cols-3 gap-1.5 p-1.5 bg-md-surface-container rounded-2xl border border-md-outline-variant/30">
          {periodOptions.map((opt) => {
            const isActive = periodType === opt.type;
            return (
              <button
                type="button"
                key={opt.type}
                onClick={() => {
                  setPeriodType(opt.type);
                  if (opt.type === 'custom') {
                    setIsCalendarModalOpen(true);
                  }
                }}
                className={clsx(
                  'min-h-[44px] px-3 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 select-none flex items-center justify-center gap-1.5 active:scale-95',
                  isActive
                    ? 'bg-md-primary-container text-md-on-primary-container shadow-xs font-bold'
                    : 'text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-surface-container-high'
                )}
              >
                {opt.type === 'custom' ? (
                  <>
                    <CalendarDays className="w-4 h-4 shrink-0" />
                    <span>Custom</span>
                  </>
                ) : (
                  opt.label
                )}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center justify-between flex-1 bg-md-surface-container rounded-2xl p-1.5 border border-md-outline-variant/30 min-h-[48px]">
            {periodType !== 'all' && periodType !== 'custom' ? (
              <button
                type="button"
                onClick={goToPrev}
                className="w-11 h-11 flex items-center justify-center rounded-xl text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-surface-container-high active:scale-95 transition-all shrink-0"
                title="Previous period"
                aria-label="Previous period"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            ) : (
              <div className="w-4" />
            )}

            <button
              type="button"
              onClick={() => {
                if (periodType === 'custom') {
                  setIsCalendarModalOpen(true);
                }
              }}
              className={clsx(
                'px-3 py-1.5 text-sm font-bold text-md-on-surface text-center truncate',
                periodType === 'custom' && 'hover:text-md-primary underline decoration-dotted underline-offset-4 cursor-pointer'
              )}
            >
              {periodLabel}
            </button>

            {periodType !== 'all' && periodType !== 'custom' ? (
              <button
                type="button"
                onClick={goToNext}
                disabled={!canGoNext}
                className={clsx(
                  "w-11 h-11 flex items-center justify-center rounded-xl text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-surface-container-high active:scale-95 transition-all shrink-0",
                  !canGoNext && "opacity-30 cursor-not-allowed pointer-events-none"
                )}
                title="Next period"
                aria-label="Next period"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            ) : (
              <div className="w-4" />
            )}
          </div>

          {periodType !== 'all' && periodType !== 'custom' && !isCurrentPeriod && (
            <button
              type="button"
              onClick={goToToday}
              className="min-h-[48px] px-4 py-2.5 rounded-2xl text-xs font-bold text-md-primary bg-md-primary/10 hover:bg-md-primary/15 active:scale-95 transition-all shrink-0"
            >
              Today
            </button>
          )}

          {periodType === 'custom' && (
            <button
              type="button"
              onClick={() => setIsCalendarModalOpen(true)}
              className="min-h-[48px] px-4 py-2.5 rounded-2xl text-xs font-bold text-md-primary bg-md-primary/10 hover:bg-md-primary/15 active:scale-95 transition-all flex items-center gap-1.5 shrink-0"
            >
              <CalendarDays className="w-4 h-4" />
              <span>Pick Dates</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Focus Statistics Overview */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-md-primary" />
          <h3 className="text-sm font-bold text-md-on-surface tracking-wide uppercase">
            Focus Overview
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Total Focus Duration */}
          <Card variant="filled" className="p-5 flex items-center gap-4 bg-md-surface-container-low border border-md-outline-variant/20 shadow-xs">
            <div className="w-12 h-12 rounded-2xl bg-md-primary/10 text-md-primary flex items-center justify-center shrink-0">
              <Clock className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <div className="text-2xl font-extrabold text-md-on-surface tracking-tight truncate">
                {formatDurationHoursMins(totalFocusSeconds)}
              </div>
              <div className="text-xs font-medium text-md-on-surface-variant">
                Focus Duration
              </div>
            </div>
          </Card>

          {/* Completed Pomodoros */}
          <Card variant="filled" className="p-5 flex items-center gap-4 bg-md-surface-container-low border border-md-outline-variant/20 shadow-xs">
            <div className="w-12 h-12 rounded-2xl bg-md-tertiary/10 text-md-tertiary flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <div className="text-2xl font-extrabold text-md-on-surface tracking-tight truncate">
                {totalWorkCount}
              </div>
              <div className="text-xs font-medium text-md-on-surface-variant">
                Completed Pomodoros
              </div>
            </div>
          </Card>

          {/* Productivity Insight */}
          <Card variant="filled" className="p-5 flex items-center gap-4 bg-md-surface-container-low border border-md-outline-variant/20 shadow-xs">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0">
              <Award className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <div className="text-xl font-bold text-md-on-surface tracking-tight truncate">
                {productiveMetric.value}
              </div>
              <div className="text-xs font-medium text-md-on-surface-variant">
                {productiveMetric.title}
              </div>
              <div className="text-[11px] text-md-outline mt-0.5 truncate">
                {productiveMetric.subtext}
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* 3. Coffee Statistics Overview */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Coffee className="w-4 h-4 text-amber-700" />
          <h3 className="text-sm font-bold text-md-on-surface tracking-wide uppercase">
            Coffee Overview
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Total Coffee Cups */}
          <Card variant="filled" className="p-5 flex items-center gap-4 bg-md-surface-container-low border border-md-outline-variant/20 shadow-xs">
            <div className="w-12 h-12 rounded-2xl bg-amber-700/10 text-amber-700 flex items-center justify-center shrink-0">
              <Coffee className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <div className="text-2xl font-extrabold text-md-on-surface tracking-tight truncate">
                {totalCoffeeCups}
              </div>
              <div className="text-xs font-medium text-md-on-surface-variant">
                {totalCoffeeCups === 1 ? 'Total Cup' : 'Total Cups'}
              </div>
              <div className="text-[11px] text-md-outline mt-0.5 truncate">
                {totalCoffeeCups === 1 ? '1 cup logged' : `${totalCoffeeCups} cups logged`}
              </div>
            </div>
          </Card>

          {/* Average Cups Per Day */}
          <Card variant="filled" className="p-5 flex items-center gap-4 bg-md-surface-container-low border border-md-outline-variant/20 shadow-xs">
            <div className="w-12 h-12 rounded-2xl bg-amber-800/10 text-amber-800 flex items-center justify-center shrink-0">
              <Calendar className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <div className="text-2xl font-extrabold text-md-on-surface tracking-tight truncate">
                {periodType === 'day' ? totalCoffeeCups : coffeeDailyAverage.toFixed(1)}
              </div>
              <div className="text-xs font-medium text-md-on-surface-variant">
                {periodType === 'day' ? 'Cups Logged' : 'Average Cups / Day'}
              </div>
              <div className="text-[11px] text-md-outline mt-0.5 truncate">
                {periodType === 'day'
                  ? 'Single day view'
                  : `Across ${coffeeElapsedDays} ${coffeeElapsedDays === 1 ? 'day' : 'days'}`}
              </div>
            </div>
          </Card>

          {/* Peak Coffee Insight */}
          <Card variant="filled" className="p-5 flex items-center gap-4 bg-md-surface-container-low border border-md-outline-variant/20 shadow-xs">
            <div className="w-12 h-12 rounded-2xl bg-amber-600/10 text-amber-600 flex items-center justify-center shrink-0">
              <Award className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <div className="text-xl font-bold text-md-on-surface tracking-tight truncate">
                {coffeePeakMetric.value}
              </div>
              <div className="text-xs font-medium text-md-on-surface-variant">
                {coffeePeakMetric.title}
              </div>
              <div className="text-[11px] text-md-outline mt-0.5 truncate">
                {coffeePeakMetric.subtext}
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* 4. Tag Distribution Donut Diagram */}
      <Card variant="filled" className="p-6 bg-md-surface-container-low border border-md-outline-variant/20">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <TagIcon className="w-5 h-5 text-md-primary" />
            <h3 className="text-base font-bold text-md-on-surface">Tag Distribution</h3>
          </div>
          <span className="text-xs text-md-on-surface-variant">
            {tagDistribution.length} tag{tagDistribution.length === 1 ? '' : 's'} in period
          </span>
        </div>

        {tagDistribution.length === 0 ? (
          <div className="text-center py-8 text-xs text-md-outline">
            No tagged sessions found for this time period.
          </div>
        ) : (
          <TagDistributionDonut
            distribution={tagDistribution}
            totalFocusSeconds={totalFocusSeconds}
          />
        )}
      </Card>

      {/* 5. Activity Bar Chart */}
      <Card variant="filled" className="p-6 bg-md-surface-container-low border border-md-outline-variant/20">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2.5">
            <Calendar className="w-5 h-5 text-md-primary" />
            <h3 className="text-base font-bold text-md-on-surface">
              Activity Breakdown
            </h3>
          </div>
        </div>

        {activityBars.length === 0 ? (
          <div className="text-center py-10 text-xs text-md-outline">
            No activity logged in this period.
          </div>
        ) : (
          <>
            {/* Desktop Horizontal Column Chart (md and up) */}
            <div className="hidden md:block w-full overflow-x-auto pb-2 scrollbar-thin">
              <div
                className="grid gap-2 md:gap-3 items-end h-44 pt-4 pb-2 border-b border-md-outline-variant/30"
                style={{
                  gridTemplateColumns: `repeat(${activityBars.length}, minmax(0, 1fr))`,
                  minWidth: chartMinWidth ? `${chartMinWidth}px` : undefined,
                }}
              >
                {activityBars.map((bar) => {
                  const heightPercent = maxSeconds > 0 ? Math.min(100, Math.round((bar.totalSeconds / maxSeconds) * 100)) : 0;
                  const hasHours = bar.totalSeconds > 0;
                  const tooltipText = `${bar.label}${bar.subLabel ? ' ' + bar.subLabel : ''}: ${formatDurationHoursMins(bar.totalSeconds)} (${bar.sessionCount} sessions)`;

                  return (
                    <div key={bar.key} className="flex flex-col items-center gap-1.5 h-full justify-end group">
                      <span className="text-[10px] md:text-xs font-semibold text-md-on-surface opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                        {formatDurationHoursMins(bar.totalSeconds)}
                      </span>
                      <div className="w-full max-w-[42px] min-w-[12px] bg-md-surface-container rounded-t-xl h-full flex items-end overflow-hidden">
                        <div
                          className={`w-full rounded-t-xl transition-all duration-500 ease-out ${
                            hasHours ? 'bg-md-primary group-hover:bg-[#584192]' : 'bg-transparent'
                          }`}
                          style={{ height: `${Math.max(hasHours ? 8 : 0, heightPercent)}%` }}
                          title={tooltipText}
                        />
                      </div>
                      <div className="flex flex-col items-center text-center w-full min-w-0">
                        <span className="text-[11px] font-semibold text-md-on-surface-variant group-hover:text-md-on-surface truncate w-full px-0.5">
                          {bar.label}
                        </span>
                        {bar.subLabel && (
                          <span className="text-[9px] text-md-outline truncate w-full px-0.5">
                            {bar.subLabel}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Mobile Vertical Stack Layout (< md only) */}
            <div className="flex md:hidden flex-col gap-2.5">
              {activityBars.map((bar) => {
                const widthPercent = maxSeconds > 0 ? Math.min(100, Math.round((bar.totalSeconds / maxSeconds) * 100)) : 0;
                const hasHours = bar.totalSeconds > 0;
                const tooltipText = `${bar.label}${bar.subLabel ? ' ' + bar.subLabel : ''}: ${formatDurationHoursMins(bar.totalSeconds)} (${bar.sessionCount} sessions)`;

                return (
                  <div
                    key={bar.key}
                    className="flex items-center gap-3 p-2.5 rounded-2xl bg-md-surface-container/60 hover:bg-md-surface-container transition-colors group"
                  >
                    <div className="w-16 shrink-0 flex flex-col">
                      <span className="text-xs font-bold text-md-on-surface truncate">
                        {bar.label}
                      </span>
                      {bar.subLabel && (
                        <span className="text-[11px] text-md-outline truncate">
                          {bar.subLabel}
                        </span>
                      )}
                    </div>

                    <div className="flex-1 h-7 bg-md-surface-container-high rounded-xl overflow-hidden flex items-center p-1">
                      <div
                        className={`h-full rounded-lg transition-all duration-500 ease-out ${
                          hasHours ? 'bg-md-primary group-hover:bg-[#584192]' : 'bg-transparent'
                        }`}
                        style={{ width: `${Math.max(hasHours ? 6 : 0, widthPercent)}%` }}
                        title={tooltipText}
                      />
                    </div>

                    <div className="w-20 shrink-0 text-right flex flex-col items-end">
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
          </>
        )}
      </Card>

      {/* Calendar Range Picker Modal */}
      <DateRangeModal
        isOpen={isCalendarModalOpen}
        onClose={() => setIsCalendarModalOpen(false)}
        currentRange={customRange}
        onApplyRange={(range) => {
          setCustomRange(range);
          setPeriodType('custom');
        }}
      />
    </div>
  );
};

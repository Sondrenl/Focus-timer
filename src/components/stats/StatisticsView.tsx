import React, { useState } from 'react';
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
} from 'lucide-react';
import { formatDurationHoursMins } from '../../utils/formatters';
import { DateRangeModal } from './DateRangeModal';
import { TagDistributionDonut } from './TagDistributionDonut';
import { SmartInsightPanel } from './SmartInsightPanel';
import { DayActivityView } from './DayActivityView';
import { WeekActivityView } from './WeekActivityView';
import { MonthActivityView } from './MonthActivityView';
import { YearActivityView } from './YearActivityView';
import { AllTimeActivityView } from './AllTimeActivityView';
import { CustomActivityView } from './CustomActivityView';
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
    coffeeElapsedDays: _coffeeElapsedDays,
    coffeePeakMetric,
    tagDistribution,
    activityBars,
    productiveMetric,
    insights,
  } = useStatistics();

  const [isCalendarModalOpen, setIsCalendarModalOpen] = useState(false);

  // Custom placed on the far right as requested
  const periodOptions: { type: TimePeriodType; label: string }[] = [
    { type: 'day', label: 'Day' },
    { type: 'week', label: 'Week' },
    { type: 'month', label: 'Month' },
    { type: 'year', label: 'Year' },
    { type: 'all', label: 'All Time' },
    { type: 'custom', label: 'Custom' },
  ];

  return (
    <div className="w-full max-w-4xl mx-auto py-6 px-4 flex flex-col gap-6">
      {/* View Header */}
      <div>
        <h2 className="text-2xl font-bold text-md-on-surface">Statistics & Insights</h2>
      </div>

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

      {/* Smart Insight Panel */}
      <SmartInsightPanel insights={insights} />

      {/* 2. Focus Statistics */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-md-primary" />
          <h3 className="text-sm font-bold text-md-on-surface tracking-wide uppercase">
            Focus
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
            </div>
          </Card>
        </div>
      </div>

      {/* 3. Coffee Statistics */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Coffee className="w-4 h-4 text-amber-700" />
          <h3 className="text-sm font-bold text-md-on-surface tracking-wide uppercase">
            Coffee
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

      {/* 5. Activity Breakdown - Calendar-Style Interface */}
      <Card variant="filled" className="p-6 bg-md-surface-container-low border border-md-outline-variant/20">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2.5">
            <Calendar className="w-5 h-5 text-md-primary" />
            <h3 className="text-base font-bold text-md-on-surface">
              Activity Breakdown
            </h3>
          </div>
        </div>

        {periodType === 'day' ? (
          <DayActivityView activityBars={activityBars} />
        ) : periodType === 'week' ? (
          <WeekActivityView activityBars={activityBars} />
        ) : periodType === 'month' ? (
          <MonthActivityView activityBars={activityBars} />
        ) : periodType === 'year' ? (
          <YearActivityView activityBars={activityBars} />
        ) : periodType === 'all' ? (
          <AllTimeActivityView activityBars={activityBars} />
        ) : (
          <CustomActivityView activityBars={activityBars} />
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

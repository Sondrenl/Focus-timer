import React, { useState } from 'react';
import { useStatistics, TimePeriodType } from '../../hooks/useStatistics';
import { Card } from '../ui/Card';
import {
  Clock,
  CheckCircle2,
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
    totalFocusHours,
    totalFocusSeconds,
    totalWorkCount,
    tagDistribution,
    activityBars,
    productiveMetric,
  } = useStatistics();

  const [isCalendarModalOpen, setIsCalendarModalOpen] = useState(false);

  // Maximum hours for scaling bar charts
  const maxHours = Math.max(1, ...activityBars.map((b) => b.hours));

  const periodOptions: { type: TimePeriodType; label: string }[] = [
    { type: 'day', label: 'Day' },
    { type: 'week', label: 'Week' },
    { type: 'month', label: 'Month' },
    { type: 'year', label: 'Year' },
    { type: 'custom', label: 'Custom' },
    { type: 'all', label: 'All Time' },
  ];

  return (
    <div className="w-full max-w-4xl mx-auto py-6 px-4 flex flex-col gap-6">
      {/* View Header */}
      <div>
        <h2 className="text-2xl font-bold text-md-on-surface">Statistics & Insights</h2>
        <p className="text-xs text-md-on-surface-variant mt-0.5">
          Review focus duration, habits, and tag distribution over time.
        </p>
      </div>

      {/* Helpful Welcome / Empty-state Banner */}
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
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 p-4 rounded-3xl bg-md-surface-container-low border border-md-outline-variant/30 shadow-xs">
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
                    <span>Custom</span>
                  </span>
                ) : (
                  opt.label
                )}
              </button>
            );
          })}
        </div>

        {/* Back / Forward Navigator */}
        <div className="flex items-center justify-between md:justify-end gap-2">
          {periodType !== 'all' ? (
            <>
              <button
                onClick={goToPrev}
                className="p-2 rounded-full text-md-on-surface-variant hover:bg-md-surface-container hover:text-md-on-surface transition-colors"
                title="Previous period"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>

              <button
                onClick={() => {
                  if (periodType === 'custom') {
                    setIsCalendarModalOpen(true);
                  }
                }}
                className={clsx(
                  'px-3 py-1.5 rounded-xl text-xs font-bold text-md-on-surface transition-colors',
                  periodType === 'custom'
                    ? 'hover:bg-md-surface-container cursor-pointer underline decoration-dotted'
                    : ''
                )}
                title={periodType === 'custom' ? 'Change custom date range' : undefined}
              >
                {periodLabel}
              </button>

              <button
                onClick={goToNext}
                className="p-2 rounded-full text-md-on-surface-variant hover:bg-md-surface-container hover:text-md-on-surface transition-colors"
                title="Next period"
              >
                <ChevronRight className="w-5 h-5" />
              </button>

              {/* Clear 'Today' Jump Button */}
              <button
                onClick={goToToday}
                className="flex items-center gap-1.5 px-3 py-1.5 ml-1 rounded-xl text-xs font-semibold bg-md-surface-container hover:bg-md-surface-container-high text-md-primary transition-all shadow-xs active:scale-95"
                title="Jump to today's date"
              >
                <Calendar className="w-3.5 h-3.5 text-md-primary" />
                <span>Today</span>
              </button>
            </>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-md-primary/10 text-md-primary text-xs font-semibold">
              <Sparkles className="w-3.5 h-3.5" />
              <span>{periodLabel}</span>
            </div>
          )}
        </div>
      </div>

      {/* 2. Key Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Total Focus Hours */}
        <Card variant="filled" className="p-5 flex items-center gap-4 bg-md-surface-container-low border border-md-outline-variant/20">
          <div className="w-12 h-12 rounded-2xl bg-md-primary/10 text-md-primary flex items-center justify-center shrink-0">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-extrabold text-md-on-surface tracking-tight">
              {totalFocusHours} <span className="text-sm font-semibold text-md-on-surface-variant">hrs</span>
            </div>
            <div className="text-xs font-medium text-md-on-surface-variant">
              Focus Duration
            </div>
            <div className="text-[11px] text-md-outline mt-0.5">
              {formatDurationHoursMins(totalFocusSeconds)} logged in period
            </div>
          </div>
        </Card>

        {/* Total Sessions */}
        <Card variant="filled" className="p-5 flex items-center gap-4 bg-md-surface-container-low border border-md-outline-variant/20">
          <div className="w-12 h-12 rounded-2xl bg-md-tertiary/10 text-md-tertiary flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-extrabold text-md-on-surface tracking-tight">
              {totalWorkCount}
            </div>
            <div className="text-xs font-medium text-md-on-surface-variant">
              Completed Pomodoros
            </div>
            <div className="text-[11px] text-md-outline mt-0.5">
              Intervals finished
            </div>
          </div>
        </Card>

        {/* Productivity Insight */}
        <Card variant="filled" className="p-5 flex items-center gap-4 bg-md-surface-container-low border border-md-outline-variant/20">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0">
            <Award className="w-6 h-6" />
          </div>
          <div>
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

      {/* 3. Tag Distribution Donut Diagram */}
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
            totalFocusHours={totalFocusHours}
          />
        )}
      </Card>

      {/* 4. Activity Bar Chart */}
      <Card variant="filled" className="p-6 bg-md-surface-container-low border border-md-outline-variant/20">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2.5">
            <Calendar className="w-5 h-5 text-md-primary" />
            <h3 className="text-base font-bold text-md-on-surface">
              Activity Breakdown ({periodType.toUpperCase()})
            </h3>
          </div>
          <span className="text-xs font-medium text-md-on-surface-variant">
            Hours per slot
          </span>
        </div>

        {activityBars.length === 0 ? (
          <div className="text-center py-10 text-xs text-md-outline">
            No activity logged in this period.
          </div>
        ) : (
          <div
            className="grid gap-2 md:gap-3 items-end h-44 pt-4 pb-2 border-b border-md-outline-variant/30"
            style={{
              gridTemplateColumns: `repeat(${activityBars.length}, minmax(0, 1fr))` ,
            }}
          >
            {activityBars.map((bar) => {
              const heightPercent = maxHours > 0 ? Math.min(100, Math.round((bar.hours / maxHours) * 100)) : 0;
              const hasHours = bar.hours > 0;

              return (
                <div key={bar.key} className="flex flex-col items-center gap-1.5 h-full justify-end group">
                  <span className="text-[10px] md:text-xs font-semibold text-md-on-surface opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                    {bar.hours}h
                  </span>
                  <div className="w-full max-w-[42px] bg-md-surface-container rounded-t-xl h-full flex items-end overflow-hidden">
                    <div
                      className={`w-full rounded-t-xl transition-all duration-500 ease-out ${
                        hasHours ? 'bg-md-primary group-hover:bg-[#584192]' : 'bg-transparent'
                      }`}
                      style={{ height: `${Math.max(hasHours ? 8 : 0, heightPercent)}%` }}
                      title={`${bar.label} ${bar.subLabel || ''}: ${bar.hours} hrs (${bar.sessionCount} sessions)`}
                    />
                  </div>
                  <div className="flex flex-col items-center text-center w-full">
                    <span className="text-[11px] font-semibold text-md-on-surface-variant group-hover:text-md-on-surface truncate w-full">
                      {bar.label}
                    </span>
                    {bar.subLabel && (
                      <span className="text-[9px] text-md-outline truncate w-full">
                        {bar.subLabel}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Calendar Range Picker Modal */}
      <DateRangeModal
        isOpen={isCalendarModalOpen}
        onClose={() => setIsCalendarModalOpen(false)}
        currentRange={customRange}
        onApplyRange={(newRange) => {
          setCustomRange(newRange);
          setPeriodType('custom');
        }}
      />
    </div>
  );
};

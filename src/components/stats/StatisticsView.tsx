import React, { useState } from 'react';
import { useStatistics } from '../../hooks/useStatistics';
import { useAuthProfile } from '../../context/AuthProfileContext';
import { useNavigation } from '../../context/NavigationContext';
import { Card } from '../ui/Card';
import {
  Clock,
  CheckCircle2,
  Coffee,
  Calendar,
  Tag as TagIcon,
  Award,
} from 'lucide-react';
import { formatDurationHoursMins } from '../../utils/formatters';
import { DateRangeModal } from './DateRangeModal';
import { PeriodNavigatorBar } from './PeriodNavigatorBar';
import { TagDistributionDonut } from './TagDistributionDonut';
import { SmartInsightPanel } from './SmartInsightPanel';
import { DayActivityView } from './DayActivityView';
import { WeekActivityView } from './WeekActivityView';
import { MonthActivityView } from './MonthActivityView';
import { YearActivityView } from './YearActivityView';
import { AllTimeActivityView } from './AllTimeActivityView';
import { CustomActivityView } from './CustomActivityView';

export const StatisticsView: React.FC = () => {
  const { auth } = useAuthProfile();
  const { setCurrentView } = useNavigation();
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
    coffeePeakMetric,
    tagDistribution,
    activityBars,
    productiveMetric,
    topInsight,
    filteredSessions,
  } = useStatistics();

  const [isCalendarModalOpen, setIsCalendarModalOpen] = useState(false);

  return (
    <div className="w-full max-w-4xl mx-auto py-6 px-4 flex flex-col gap-6 min-w-0">
      {/* View Header */}
      <div>
        <h2 className="text-2xl font-bold text-md-on-surface">Statistics</h2>
      </div>

      {auth.isTokenExpired && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-amber-900 dark:text-amber-200">
          <div>
            <p className="text-sm font-bold">Google Session Expired</p>
            <p className="text-xs opacity-90 mt-0.5">
              Google security tokens expire after 1 hour. Tap to refresh your Google session and load your statistics.
            </p>
          </div>
          <button
            onClick={() => {
              if (typeof window !== 'undefined' && window.google?.accounts?.id) {
                window.google.accounts.id.prompt();
              }
              setCurrentView('profile');
            }}
            className="px-3.5 py-1.5 rounded-xl bg-amber-600 text-white font-medium text-xs hover:bg-amber-700 active:scale-95 transition-all shrink-0 shadow-xs"
          >
            Reconnect Google
          </button>
        </div>
      )}

      {/* 1. Time Period Selector & Period Navigator */}
      <PeriodNavigatorBar
        periodType={periodType}
        setPeriodType={setPeriodType}
        periodLabel={periodLabel}
        isCurrentPeriod={isCurrentPeriod}
        canGoNext={canGoNext}
        onOpenCalendarModal={() => setIsCalendarModalOpen(true)}
        goToPrev={goToPrev}
        goToNext={goToNext}
        goToToday={goToToday}
      />

      {/* Smart Insight Panel */}
      <SmartInsightPanel insight={topInsight} />

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
      <Card variant="filled" className="p-4 sm:p-6 bg-md-surface-container-low border border-md-outline-variant/20">
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
      <Card variant="filled" className="p-4 sm:p-6 bg-md-surface-container-low border border-md-outline-variant/20">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2.5">
            <Calendar className="w-5 h-5 text-md-primary" />
            <h3 className="text-base font-bold text-md-on-surface">
              Activity Breakdown
            </h3>
          </div>
        </div>

        {periodType === 'day' ? (
          <DayActivityView sessions={filteredSessions} activityBars={activityBars} />
        ) : periodType === 'week' ? (
          <WeekActivityView activityBars={activityBars} />
        ) : periodType === 'month' ? (
          <MonthActivityView activityBars={activityBars} />
        ) : periodType === 'year' ? (
          <YearActivityView activityBars={activityBars} isCurrentYear={isCurrentPeriod} />
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

import React from 'react';
import { useStatistics } from '../../hooks/useStatistics';
import { Card } from '../ui/Card';
import { Clock, CheckCircle2, TrendingUp, Calendar, Tag as TagIcon, Award } from 'lucide-react';
import { formatDurationHoursMins } from '../../utils/formatters';

export const StatisticsView: React.FC = () => {
  const {
    totalFocusHours,
    totalFocusSeconds,
    totalWorkCount,
    tagDistribution,
    dailyActivity,
    mostProductiveDay,
  } = useStatistics();

  // Find max daily hours for scaling chart bars
  const maxDailyHours = Math.max(1, ...dailyActivity.map((d) => d.hours));

  return (
    <div className="w-full max-w-4xl mx-auto py-6 px-4 flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold text-md-on-surface">Statistics & Insights</h2>
        <p className="text-xs text-md-on-surface-variant mt-0.5">
          Quantify your focus intervals, habits, and category distribution.
        </p>
      </div>

      {/* Top 3 High-Level Metric Cards */}
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
              Total Focus Time
            </div>
            <div className="text-[11px] text-md-outline mt-0.5">
              {formatDurationHoursMins(totalFocusSeconds)} logged
            </div>
          </div>
        </Card>

        {/* Total Work Sessions */}
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
              Focus intervals finished
            </div>
          </div>
        </Card>

        {/* Most Productive Day */}
        <Card variant="filled" className="p-5 flex items-center gap-4 bg-md-surface-container-low border border-md-outline-variant/20">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0">
            <Award className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xl font-bold text-md-on-surface tracking-tight truncate">
              {mostProductiveDay.hasData ? mostProductiveDay.dayName : 'N/A'}
            </div>
            <div className="text-xs font-medium text-md-on-surface-variant">
              Peak Focus Day
            </div>
            <div className="text-[11px] text-md-outline mt-0.5">
              {mostProductiveDay.hasData ? `${mostProductiveDay.totalHours} hrs on ${mostProductiveDay.dayName}s` : 'Keep tracking sessions'}
            </div>
          </div>
        </Card>
      </div>

      {/* Daily Activity Chart (Last 7 Days) */}
      <Card variant="filled" className="p-6 bg-md-surface-container-low border border-md-outline-variant/20">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2.5">
            <Calendar className="w-5 h-5 text-md-primary" />
            <h3 className="text-base font-bold text-md-on-surface">Daily Activity (Last 7 Days)</h3>
          </div>
          <span className="text-xs font-medium text-md-on-surface-variant">
            Hours per day
          </span>
        </div>

        {/* Bar chart visualisation */}
        <div className="grid grid-cols-7 gap-2 md:gap-4 items-end h-44 pt-4 pb-2 border-b border-md-outline-variant/30">
          {dailyActivity.map((day) => {
            const heightPercent = maxDailyHours > 0 ? Math.min(100, Math.round((day.hours / maxDailyHours) * 100)) : 0;
            const hasHours = day.hours > 0;

            return (
              <div key={day.dateKey} className="flex flex-col items-center gap-2 h-full justify-end group">
                <span className="text-[10px] md:text-xs font-semibold text-md-on-surface opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                  {day.hours}h
                </span>
                <div className="w-full max-w-[42px] bg-md-surface-container rounded-t-xl h-full flex items-end overflow-hidden">
                  <div
                    className={`w-full rounded-t-xl transition-all duration-500 ease-out ${
                      hasHours ? 'bg-md-primary group-hover:bg-[#584192]' : 'bg-transparent'
                    }`}
                    style={{ height: `${Math.max(hasHours ? 8 : 0, heightPercent)}%` }}
                    title={`${day.label}: ${day.hours} hrs (${day.sessionCount} sessions)`}
                  />
                </div>
                <span className="text-[11px] font-medium text-md-on-surface-variant group-hover:text-md-on-surface text-center truncate w-full">
                  {day.label.split(',')[0]}
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Per-Tag Distribution Breakdown */}
      <Card variant="filled" className="p-6 bg-md-surface-container-low border border-md-outline-variant/20">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <TagIcon className="w-5 h-5 text-md-primary" />
            <h3 className="text-base font-bold text-md-on-surface">Per-Tag Distribution</h3>
          </div>
          <span className="text-xs text-md-on-surface-variant">
            {tagDistribution.length} categor{tagDistribution.length === 1 ? 'y' : 'ies'}
          </span>
        </div>

        {tagDistribution.length === 0 ? (
          <div className="text-center py-8 text-xs text-md-outline">
            No tagged focus sessions recorded yet.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {tagDistribution.map((item) => (
              <div key={item.tagId} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-3 h-3 rounded-full shrink-0 shadow-xs"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="font-semibold text-md-on-surface truncate">
                      {item.name}
                    </span>
                    {item.isArchived && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-md-surface-variant text-md-outline font-medium">
                        Archived
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0 font-medium text-md-on-surface-variant">
                    <span>{item.hours} hrs</span>
                    <span className="w-10 text-right font-bold text-md-primary">{item.percentage}%</span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="w-full h-2 rounded-full bg-md-surface-container overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${item.percentage}%`,
                      backgroundColor: item.color,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Productivity Metric Detail */}
      <div className="p-4 bg-md-surface-container rounded-3xl border border-md-outline-variant/20 flex items-center gap-3 text-xs text-md-on-surface-variant">
        <TrendingUp className="w-5 h-5 text-md-primary shrink-0" />
        <div>
          <span className="font-bold text-md-on-surface">Productivity Insight: </span>
          {mostProductiveDay.hasData ? (
            <>
              You complete your greatest concentration volume on <strong>{mostProductiveDay.dayName}s</strong> with a total of <strong>{mostProductiveDay.totalHours} hours</strong> logged across {mostProductiveDay.sessionCount} sessions.
            </>
          ) : (
            'Complete your first focus sessions to reveal weekly rhythm analytics.'
          )}
        </div>
      </div>
    </div>
  );
};

import React, { useMemo } from 'react';
import { CompletedSession } from '../../types/session';
import { ActivityBarStat } from '../../hooks/useStatistics';
import { formatDurationHoursMins } from '../../utils/formatters';
import { computeDayTimeRangeBreakdown, DayTimeRangeId } from '../../utils/stats/dayTimeRanges';
import { Sunrise, Sun, CloudSun, Sunset, Moon } from 'lucide-react';
import { clsx } from 'clsx';

interface DayActivityViewProps {
  sessions?: CompletedSession[];
  activityBars?: ActivityBarStat[];
}

const RANGE_META: Record<
  DayTimeRangeId,
  {
    icon: React.ComponentType<{ className?: string }>;
    iconColor: string;
    badgeBg: string;
  }
> = {
  morning: {
    icon: Sunrise,
    iconColor: 'text-amber-500',
    badgeBg: 'bg-amber-500/10 border-amber-500/20',
  },
  midday: {
    icon: Sun,
    iconColor: 'text-yellow-600',
    badgeBg: 'bg-yellow-500/10 border-yellow-500/20',
  },
  afternoon: {
    icon: CloudSun,
    iconColor: 'text-orange-500',
    badgeBg: 'bg-orange-500/10 border-orange-500/20',
  },
  evening: {
    icon: Sunset,
    iconColor: 'text-indigo-500',
    badgeBg: 'bg-indigo-500/10 border-indigo-500/20',
  },
  night: {
    icon: Moon,
    iconColor: 'text-purple-500',
    badgeBg: 'bg-purple-500/10 border-purple-500/20',
  },
};

function formatBucketDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0m';
  const formatted = formatDurationHoursMins(totalSeconds);
  return formatted === '0m' ? '<1m' : formatted;
}

export const DayActivityView: React.FC<DayActivityViewProps> = ({
  sessions = [],
  activityBars = [],
}) => {
  const ranges = useMemo(() => {
    return computeDayTimeRangeBreakdown(sessions, activityBars);
  }, [sessions, activityBars]);

  const totalDaySeconds = useMemo(() => {
    return ranges.reduce((acc, r) => acc + r.totalSeconds, 0);
  }, [ranges]);

  const maxRangeSeconds = useMemo(() => {
    return Math.max(1, ...ranges.map((r) => r.totalSeconds));
  }, [ranges]);

  if (totalDaySeconds === 0) {
    return (
      <div className="text-center py-8 text-xs text-md-outline">
        No focus sessions logged for this day.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 min-w-0">
      {ranges.map((r) => {
        const meta = RANGE_META[r.id];
        const Icon = meta.icon;
        const pct = maxRangeSeconds > 0 ? Math.round((r.totalSeconds / maxRangeSeconds) * 100) : 0;
        const shareOfTotal = totalDaySeconds > 0 ? Math.round((r.totalSeconds / totalDaySeconds) * 100) : 0;

        return (
          <div
            key={r.id}
            className="p-3 sm:p-3.5 rounded-2xl border border-md-outline-variant/25 bg-md-surface-container/40 flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-4 min-w-0"
          >
            {/* Header / Left label */}
            <div className="flex items-center justify-between gap-2 sm:w-48 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className={clsx('w-9 h-9 rounded-xl flex items-center justify-center border shrink-0', meta.badgeBg)}>
                  <Icon className={clsx('w-5 h-5', meta.iconColor)} />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-md-on-surface">
                    {r.title}
                  </div>
                  <div className="text-[11px] text-md-outline font-medium tabular-nums">
                    {r.timeRange}
                  </div>
                </div>
              </div>

              {/* Mobile duration */}
              <div
                className={clsx(
                  'sm:hidden text-xs font-bold tabular-nums shrink-0',
                  r.totalSeconds > 0 ? 'text-md-on-surface' : 'text-md-outline/50'
                )}
              >
                {formatBucketDuration(r.totalSeconds)}
              </div>
            </div>

            {/* Proportional Bar & Share % */}
            <div className="flex-1 min-w-0 flex items-center gap-2.5">
              <div className="flex-1 min-w-0 h-2 bg-md-surface-container-highest/60 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-md-primary transition-[width] duration-300 ease-out"
                  style={{ width: `${r.totalSeconds > 0 ? Math.max(6, pct) : 0}%` }}
                />
              </div>
              <span className="text-[10px] font-bold text-md-outline tabular-nums shrink-0 w-8 text-right">
                {shareOfTotal > 0 ? `${shareOfTotal}%` : '—'}
              </span>
            </div>

            {/* Desktop duration */}
            <div
              className={clsx(
                'hidden sm:block w-16 text-right text-xs font-bold tabular-nums shrink-0',
                r.totalSeconds > 0 ? 'text-md-on-surface' : 'text-md-outline/50'
              )}
            >
              {formatBucketDuration(r.totalSeconds)}
            </div>
          </div>
        );
      })}
    </div>
  );
};

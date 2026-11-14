import React, { useMemo } from 'react';
import { CompletedSession } from '../../types/session';
import { ActivityBarStat } from '../../hooks/useStatistics';
import { formatDurationHoursMins } from '../../utils/formatters';
import { Sunrise, Sun, Sunset, Moon } from 'lucide-react';
import { clsx } from 'clsx';

interface DayActivityViewProps {
  sessions?: CompletedSession[];
  activityBars?: ActivityBarStat[];
}

interface TimeQuadrant {
  id: 'morning' | 'afternoon' | 'evening' | 'night';
  title: string;
  timeRange: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  badgeBg: string;
  totalSeconds: number;
  sessionCount: number;
}

export const DayActivityView: React.FC<DayActivityViewProps> = ({
  sessions = [],
  activityBars = [],
}) => {
  // Filter to work/focus sessions
  const workSessions = useMemo(() => {
    return sessions
      .filter((s) => s.sessionType === 'WORK')
      .sort((a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime());
  }, [sessions]);

  // Aggregate focus time and sessions into 4 natural daily quadrants
  const quadrants = useMemo<TimeQuadrant[]>(() => {
    let morningSec = 0;
    let morningCount = 0;
    let afternoonSec = 0;
    let afternoonCount = 0;
    let eveningSec = 0;
    let eveningCount = 0;
    let nightSec = 0;
    let nightCount = 0;

    if (workSessions.length > 0) {
      workSessions.forEach((s) => {
        const d = new Date(s.completedAt);
        const hour = d.getHours();
        if (hour >= 6 && hour < 12) {
          morningSec += s.durationSeconds;
          morningCount += 1;
        } else if (hour >= 12 && hour < 17) {
          afternoonSec += s.durationSeconds;
          afternoonCount += 1;
        } else if (hour >= 17 && hour < 22) {
          eveningSec += s.durationSeconds;
          eveningCount += 1;
        } else {
          nightSec += s.durationSeconds;
          nightCount += 1;
        }
      });
    } else if (activityBars.length > 0) {
      // Fallback from hourly activityBars if direct session objects aren't available
      activityBars.forEach((bar) => {
        const match = bar.key.match(/hour-(\d+)/) || bar.label.match(/^(\d+):/);
        const h = match ? parseInt(match[1], 10) : NaN;
        if (!isNaN(h)) {
          if (h >= 6 && h < 12) {
            morningSec += bar.totalSeconds;
            morningCount += bar.sessionCount;
          } else if (h >= 12 && h < 17) {
            afternoonSec += bar.totalSeconds;
            afternoonCount += bar.sessionCount;
          } else if (h >= 17 && h < 22) {
            eveningSec += bar.totalSeconds;
            eveningCount += bar.sessionCount;
          } else {
            nightSec += bar.totalSeconds;
            nightCount += bar.sessionCount;
          }
        }
      });
    }

    return [
      {
        id: 'morning',
        title: 'Morning',
        timeRange: '06:00 – 12:00',
        icon: Sunrise,
        iconColor: 'text-amber-500',
        badgeBg: 'bg-amber-500/10 border-amber-500/20',
        totalSeconds: morningSec,
        sessionCount: morningCount,
      },
      {
        id: 'afternoon',
        title: 'Afternoon',
        timeRange: '12:00 – 17:00',
        icon: Sun,
        iconColor: 'text-orange-500',
        badgeBg: 'bg-orange-500/10 border-orange-500/20',
        totalSeconds: afternoonSec,
        sessionCount: afternoonCount,
      },
      {
        id: 'evening',
        title: 'Evening',
        timeRange: '17:00 – 22:00',
        icon: Sunset,
        iconColor: 'text-indigo-500',
        badgeBg: 'bg-indigo-500/10 border-indigo-500/20',
        totalSeconds: eveningSec,
        sessionCount: eveningCount,
      },
      {
        id: 'night',
        title: 'Night',
        timeRange: '22:00 – 06:00',
        icon: Moon,
        iconColor: 'text-purple-500',
        badgeBg: 'bg-purple-500/10 border-purple-500/20',
        totalSeconds: nightSec,
        sessionCount: nightCount,
      },
    ];
  }, [workSessions, activityBars]);

  const totalDaySeconds = useMemo(() => {
    return quadrants.reduce((acc, q) => acc + q.totalSeconds, 0);
  }, [quadrants]);

  const maxQuadrantSeconds = useMemo(() => {
    return Math.max(1, ...quadrants.map((q) => q.totalSeconds));
  }, [quadrants]);

  if (totalDaySeconds === 0) {
    return (
      <div className="text-center py-8 text-xs text-md-outline">
        No focus sessions logged for this day.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {quadrants.map((q) => {
        const Icon = q.icon;
        const pct = maxQuadrantSeconds > 0 ? Math.round((q.totalSeconds / maxQuadrantSeconds) * 100) : 0;
        const shareOfTotal = totalDaySeconds > 0 ? Math.round((q.totalSeconds / totalDaySeconds) * 100) : 0;

        return (
          <div
            key={q.id}
            className="p-3.5 sm:p-4 rounded-2xl border border-md-outline-variant/30 bg-md-surface-container/40 flex flex-col justify-between gap-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className={clsx('w-9 h-9 rounded-xl flex items-center justify-center border shrink-0', q.badgeBg)}>
                  <Icon className={clsx('w-5 h-5', q.iconColor)} />
                </div>
                <div>
                  <div className="text-xs font-bold text-md-on-surface">
                    {q.title}
                  </div>
                  <div className="text-[11px] text-md-outline font-medium">
                    {q.timeRange}
                  </div>
                </div>
              </div>

              <div className="text-right">
                <div className={clsx('text-xs font-bold tabular-nums', q.totalSeconds > 0 ? 'text-md-on-surface' : 'text-md-outline/60')}>
                  {q.totalSeconds > 0 ? formatDurationHoursMins(q.totalSeconds) : '0m'}
                </div>
                <div className="text-[10px] text-md-on-surface-variant font-medium">
                  {q.sessionCount > 0 ? `${q.sessionCount} ${q.sessionCount === 1 ? 'session' : 'sessions'}` : '—'}
                </div>
              </div>
            </div>

            {/* Intensity Progress Bar */}
            <div className="w-full flex items-center gap-2">
              <div className="flex-1 h-2 bg-md-surface-container-highest/60 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-md-primary transition-all duration-500 ease-out"
                  style={{ width: `${Math.max(q.totalSeconds > 0 ? 8 : 0, pct)}%` }}
                />
              </div>
              {shareOfTotal > 0 && (
                <span className="text-[10px] font-bold text-md-outline tabular-nums shrink-0 w-8 text-right">
                  {shareOfTotal}%
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

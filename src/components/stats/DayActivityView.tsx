import React, { useMemo } from 'react';
import { CompletedSession } from '../../types/session';
import { ActivityBarStat } from '../../hooks/useStatistics';
import { useApp } from '../../context/AppContext';
import { formatDurationHoursMins } from '../../utils/formatters';
import { Sunrise, Sun, Sunset, Moon, Clock, Award, Sparkles } from 'lucide-react';
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
  const { tags } = useApp();

  // Create tag lookup map for quick resolution of names and colors
  const tagMap = useMemo(() => {
    return new Map(tags.map((t) => [t.id, t]));
  }, [tags]);

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

  const totalSessionCount = useMemo(() => {
    return workSessions.length > 0
      ? workSessions.length
      : quadrants.reduce((acc, q) => acc + q.sessionCount, 0);
  }, [workSessions, quadrants]);

  // Peak focus quadrant
  const peakQuadrant = useMemo(() => {
    let top: TimeQuadrant | null = null;
    for (const q of quadrants) {
      if (q.totalSeconds > 0 && (!top || q.totalSeconds > top.totalSeconds)) {
        top = q;
      }
    }
    return top;
  }, [quadrants]);

  const maxQuadrantSeconds = useMemo(() => {
    return Math.max(1, ...quadrants.map((q) => q.totalSeconds));
  }, [quadrants]);

  return (
    <div className="flex flex-col gap-6">
      {/* 1. Header Overview */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-1 border-b border-md-outline-variant/15">
        <div>
          <span className="text-xs font-bold text-md-on-surface uppercase tracking-wider">
            Daily Focus Flow
          </span>
          <div className="text-sm font-semibold text-md-on-surface-variant mt-0.5">
            {totalDaySeconds > 0 ? (
              <span>
                <span className="text-md-on-surface font-bold">
                  {formatDurationHoursMins(totalDaySeconds)}
                </span>{' '}
                focused across{' '}
                <span className="text-md-on-surface font-bold">
                  {totalSessionCount} {totalSessionCount === 1 ? 'session' : 'sessions'}
                </span>
              </span>
            ) : (
              <span>No focus time recorded for this day</span>
            )}
          </div>
        </div>

        {peakQuadrant && (
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-md-primary/10 border border-md-primary/20 text-xs font-semibold text-md-primary shrink-0 self-start sm:self-auto">
            <Award className="w-4 h-4 text-amber-500 shrink-0" />
            <span>Peak Window: <span className="font-bold">{peakQuadrant.title}</span></span>
          </div>
        )}
      </div>

      {/* 2. Natural Day Rhythm Quadrants (Morning / Afternoon / Evening / Night) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {quadrants.map((q) => {
          const Icon = q.icon;
          const isPeak = peakQuadrant?.id === q.id && q.totalSeconds > 0;
          const pct = maxQuadrantSeconds > 0 ? Math.round((q.totalSeconds / maxQuadrantSeconds) * 100) : 0;
          const shareOfTotal = totalDaySeconds > 0 ? Math.round((q.totalSeconds / totalDaySeconds) * 100) : 0;

          return (
            <div
              key={q.id}
              className={clsx(
                'p-3.5 sm:p-4 rounded-2xl border transition-all flex flex-col justify-between gap-3',
                isPeak
                  ? 'bg-md-primary/5 border-md-primary/30 ring-1 ring-md-primary/20'
                  : 'bg-md-surface-container/60 border-md-outline-variant/25'
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className={clsx('w-9 h-9 rounded-xl flex items-center justify-center border shrink-0', q.badgeBg)}>
                    <Icon className={clsx('w-5 h-5', q.iconColor)} />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-md-on-surface flex items-center gap-1.5">
                      <span>{q.title}</span>
                      {isPeak && (
                        <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-md-primary text-white leading-none">
                          Peak
                        </span>
                      )}
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
                <div className="flex-1 h-2 bg-md-surface-container-highest rounded-full overflow-hidden">
                  <div
                    className={clsx(
                      'h-full rounded-full transition-all duration-500 ease-out',
                      isPeak ? 'bg-md-primary' : 'bg-md-primary/60'
                    )}
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

      {/* 3. Chronological Focus Session Log */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold text-md-on-surface uppercase tracking-wider">
            <Clock className="w-3.5 h-3.5 text-md-primary" />
            <span>Completed Focus Sessions</span>
          </div>
          {workSessions.length > 0 && (
            <span className="text-xs text-md-on-surface-variant font-medium">
              {workSessions.length} {workSessions.length === 1 ? 'session' : 'sessions'}
            </span>
          )}
        </div>

        {workSessions.length === 0 ? (
          <div className="text-center py-8 px-4 rounded-2xl bg-md-surface-container/30 border border-md-outline-variant/15 flex flex-col items-center justify-center gap-2">
            <div className="w-10 h-10 rounded-2xl bg-md-surface-container-high flex items-center justify-center text-md-outline/60">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="text-xs font-semibold text-md-on-surface">
              No focus sessions logged for this day
            </div>
            <div className="text-[11px] text-md-outline max-w-xs">
              Complete a pomodoro with the timer to start logging your daily rhythm and session timeline.
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {workSessions.map((s, idx) => {
              const d = new Date(s.completedAt);
              const timeString = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              const tag = s.tagId ? tagMap.get(s.tagId) : null;
              const tagName = tag ? tag.name : 'No Tag';
              const tagColor = tag ? tag.color : '#8C8690';

              return (
                <div
                  key={s.id || `session-${idx}`}
                  className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-md-surface-container/60 border border-md-outline-variant/20 hover:bg-md-surface-container transition-colors"
                >
                  {/* Left: Sequence and Tag */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-7 h-7 rounded-xl bg-md-primary/10 text-md-primary flex items-center justify-center font-bold text-xs shrink-0">
                      #{idx + 1}
                    </div>

                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-3 h-3 rounded-full shrink-0 shadow-xs"
                        style={{ backgroundColor: tagColor }}
                      />
                      <span className="text-xs font-bold text-md-on-surface truncate">
                        {tagName}
                      </span>
                    </div>
                  </div>

                  {/* Right: Time and Duration Badge */}
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[11px] font-medium text-md-outline tabular-nums">
                      {timeString}
                    </span>
                    <span className="text-xs font-bold px-2.5 py-1 rounded-xl bg-md-primary-container text-md-on-primary-container tabular-nums">
                      {formatDurationHoursMins(s.durationSeconds)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

import React, { useMemo } from 'react';
import { formatDurationHoursMins } from '../../utils/formatters';
import { MONTH_NAMES } from '../../utils/dates';
import { clsx } from 'clsx';

const SHORT_WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export interface WeeklyRhythmDayInput {
  dateKey: string;
  totalSeconds: number;
  sessionCount: number;
  tooltipLabel?: string;
}

export interface WeeklyRhythmDay {
  dateKey: string;
  dayNum: number;
  weekdayIndex: number; // 0=Mon .. 6=Sun
  totalSeconds: number;
  sessionCount: number;
  isInScope: boolean;
  isToday: boolean;
  tooltipLabel: string;
}

export interface WeeklyRhythmGroup {
  weekNumber: number;
  label: string;
  totalSeconds: number;
  sessionCount: number;
  isCurrentWeek: boolean;
  days: WeeklyRhythmDay[];
}

function formatShortDate(dateKey: string): string {
  if (!dateKey) return '';
  const [, monthNum, dayNum] = dateKey.split('-').map(Number);
  return `${dayNum} ${MONTH_NAMES[monthNum - 1]?.slice(0, 3) || ''}`;
}

/**
 * Groups an ordered list of calendar days into Monday–Sunday weekly rhythm rows,
 * padded with out-of-scope placeholders on leading/trailing edges and returned newest-first.
 */
export function buildWeeklyRhythmGroups(
  days: WeeklyRhythmDayInput[],
  todayKey: string,
  options?: { compactSameMonthLabel?: boolean }
): WeeklyRhythmGroup[] {
  if (days.length === 0) return [];

  const weeks: WeeklyRhythmGroup[] = [];
  let currentWeekDays: WeeklyRhythmDay[] = [];
  let weekIndex = 1;

  for (let i = 0; i < days.length; i++) {
    const item = days[i];
    const [y, m, d] = item.dateKey.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    const weekdayIndex = (dateObj.getDay() + 6) % 7; // Mon=0 .. Sun=6
    const isToday = item.dateKey === todayKey;

    if (i === 0 && weekdayIndex > 0) {
      for (let pad = 0; pad < weekdayIndex; pad++) {
        currentWeekDays.push({
          dateKey: `pad-pre-${pad}`,
          dayNum: 0,
          weekdayIndex: pad,
          totalSeconds: 0,
          sessionCount: 0,
          isInScope: false,
          isToday: false,
          tooltipLabel: '',
        });
      }
    }

    currentWeekDays.push({
      dateKey: item.dateKey,
      dayNum: d,
      weekdayIndex,
      totalSeconds: item.totalSeconds,
      sessionCount: item.sessionCount,
      isInScope: true,
      isToday,
      tooltipLabel: item.tooltipLabel ?? item.dateKey,
    });

    if (weekdayIndex === 6 || i === days.length - 1) {
      if (i === days.length - 1 && weekdayIndex < 6) {
        for (let pad = weekdayIndex + 1; pad <= 6; pad++) {
          currentWeekDays.push({
            dateKey: `pad-post-${pad}`,
            dayNum: 0,
            weekdayIndex: pad,
            totalSeconds: 0,
            sessionCount: 0,
            isInScope: false,
            isToday: false,
            tooltipLabel: '',
          });
        }
      }

      const inScopeDays = currentWeekDays.filter((day) => day.isInScope);
      const firstKey = inScopeDays[0]?.dateKey || '';
      const lastKey = inScopeDays[inScopeDays.length - 1]?.dateKey || '';

      let label: string;
      if (options?.compactSameMonthLabel && firstKey && lastKey) {
        const [, firstMonth, firstDay] = firstKey.split('-').map(Number);
        const [, lastMonth, lastDay] = lastKey.split('-').map(Number);
        if (firstMonth === lastMonth) {
          label = `${firstDay} – ${lastDay} ${MONTH_NAMES[firstMonth - 1]?.slice(0, 3) || ''}`;
        } else {
          label = `${formatShortDate(firstKey)} – ${formatShortDate(lastKey)}`;
        }
      } else {
        label = `${formatShortDate(firstKey)} – ${formatShortDate(lastKey)}`;
      }

      const totalSeconds = inScopeDays.reduce((acc, day) => acc + day.totalSeconds, 0);
      const sessionCount = inScopeDays.reduce((acc, day) => acc + day.sessionCount, 0);
      const isCurrentWeek = inScopeDays.some((day) => day.isToday);

      weeks.push({
        weekNumber: weekIndex,
        label,
        totalSeconds,
        sessionCount,
        isCurrentWeek,
        days: currentWeekDays,
      });

      currentWeekDays = [];
      weekIndex++;
    }
  }

  return weeks.reverse();
}

interface WeeklyRhythmBreakdownProps {
  weeks: WeeklyRhythmGroup[];
  keyPrefix: string;
}

export const WeeklyRhythmBreakdown: React.FC<WeeklyRhythmBreakdownProps> = ({
  weeks,
  keyPrefix,
}) => {
  const maxWeekSeconds = useMemo(() => {
    return Math.max(1, ...weeks.map((w) => w.totalSeconds));
  }, [weeks]);

  return (
    <div className="flex flex-col gap-2.5">
      {weeks.map((week) => {
        const widthPct =
          maxWeekSeconds > 0 ? Math.round((week.totalSeconds / maxWeekSeconds) * 100) : 0;

        return (
          <div
            key={`${keyPrefix}-${week.weekNumber}`}
            className={clsx(
              'p-3 sm:p-3.5 rounded-2xl border transition-colors flex flex-col gap-2.5',
              week.isCurrentWeek
                ? 'bg-md-primary/5 border-md-primary/30 ring-1 ring-md-primary/20'
                : 'bg-md-surface-container/40 border-md-outline-variant/20 hover:bg-md-surface-container/60'
            )}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              {/* Week Label & Date Range */}
              <div className="flex items-center gap-2.5 min-w-[140px] shrink-0">
                <span className="text-xs font-bold text-md-on-surface">
                  Week {week.weekNumber}
                </span>
                <span className="text-[11px] font-medium text-md-outline">
                  {week.label}
                </span>
                {week.isCurrentWeek && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-md-primary text-white leading-none">
                    CURRENT
                  </span>
                )}
              </div>

              {/* Discrete Habit Pips (Mon to Sun) */}
              <div className="flex items-center gap-1.5 self-start sm:self-auto">
                {week.days.map((d) => {
                  const dayLetter = SHORT_WEEKDAYS[d.weekdayIndex];
                  if (!d.isInScope) {
                    return (
                      <div
                        key={d.dateKey}
                        className="w-6 h-6 rounded-lg opacity-15 flex items-center justify-center text-[10px] text-md-outline"
                      >
                        {dayLetter}
                      </div>
                    );
                  }

                  const hasFocus = d.totalSeconds > 0;

                  return (
                    <div
                      key={d.dateKey}
                      title={
                        hasFocus
                          ? `${d.tooltipLabel}: ${formatDurationHoursMins(d.totalSeconds)} (${d.sessionCount} sessions)`
                          : `${d.tooltipLabel}: No focus`
                      }
                      className={clsx(
                        'w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold transition-all',
                        hasFocus
                          ? 'bg-md-primary text-white shadow-xs'
                          : d.isToday
                          ? 'border border-md-primary/60 text-md-primary'
                          : 'bg-md-surface-container-high/80 text-md-outline/60'
                      )}
                    >
                      {dayLetter}
                    </div>
                  );
                })}
              </div>

              {/* Duration & Session Count on Right */}
              <div className="text-left sm:text-right flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 min-w-[110px] shrink-0">
                <span className="text-xs font-bold tabular-nums text-md-on-surface">
                  {week.totalSeconds > 0 ? formatDurationHoursMins(week.totalSeconds) : '0m'}
                </span>
                <span className="text-[10px] text-md-on-surface-variant font-medium">
                  {week.sessionCount > 0
                    ? `${week.sessionCount} ${week.sessionCount === 1 ? 'session' : 'sessions'}`
                    : '—'}
                </span>
              </div>
            </div>

            {/* Weekly Volume Bar */}
            <div className="w-full h-1.5 bg-md-surface-container-highest/60 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-md-primary transition-all duration-500 ease-out"
                style={{ width: `${Math.max(week.totalSeconds > 0 ? 6 : 0, widthPct)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

import React, { useState, useMemo } from 'react';
import { ActivityBarStat } from '../../hooks/useStatistics';
import { formatDurationHoursMins, formatCompactDuration } from '../../utils/formatters';
import { WEEKDAY_NAMES, MONTH_NAMES, toDateKey } from '../../utils/dates';
import { clsx } from 'clsx';
import { getActivityIntensityStyle } from './activityUtils';

interface MonthActivityViewProps {
  activityBars: ActivityBarStat[];
}

const SHORT_WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const MonthActivityView: React.FC<MonthActivityViewProps> = ({ activityBars }) => {
  const [hoveredDayKey, setHoveredDayKey] = useState<string | null>(null);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);

  const todayKey = useMemo(() => toDateKey(new Date()), []);

  // Parse Year and Month from the first bar's key (format 'YYYY-MM-DD')
  const { year, monthIndex, startingDayOfWeek, daysInMonth, monthName } = useMemo(() => {
    if (activityBars.length === 0) {
      const now = new Date();
      return {
        year: now.getFullYear(),
        monthIndex: now.getMonth(),
        startingDayOfWeek: 0,
        daysInMonth: 30,
        monthName: MONTH_NAMES[now.getMonth()],
      };
    }

    const [y, m] = activityBars[0].key.split('-').map(Number);
    const monthIdx = m - 1;
    const firstDay = new Date(y, monthIdx, 1);
    const startDow = (firstDay.getDay() + 6) % 7;
    const totalDays = new Date(y, m, 0).getDate();

    return {
      year: y,
      monthIndex: monthIdx,
      startingDayOfWeek: startDow,
      daysInMonth: totalDays,
      monthName: MONTH_NAMES[monthIdx],
    };
  }, [activityBars]);

  // Map of dateKey -> bar
  const dayMap = useMemo(() => {
    const map = new Map<string, ActivityBarStat>();
    activityBars.forEach((bar) => map.set(bar.key, bar));
    return map;
  }, [activityBars]);

  const maxDaySeconds = useMemo(() => {
    return Math.max(1, ...activityBars.map((b) => b.totalSeconds));
  }, [activityBars]);

  const totalActiveDays = useMemo(() => {
    return activityBars.filter((b) => b.totalSeconds > 0).length;
  }, [activityBars]);

  const consistencyPct = useMemo(() => {
    return daysInMonth > 0 ? Math.round((totalActiveDays / daysInMonth) * 100) : 0;
  }, [totalActiveDays, daysInMonth]);

  const activeKey = hoveredDayKey || selectedDayKey;
  const inspectedBar = useMemo(() => {
    if (!activeKey) return null;
    return dayMap.get(activeKey) || null;
  }, [activeKey, dayMap]);

  const formatInspectedDate = (dateKey: string) => {
    const [y, m, d] = dateKey.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    const weekday = WEEKDAY_NAMES[dateObj.getDay()];
    return `${weekday}, ${d} ${MONTH_NAMES[m - 1]}`;
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Non-duplicative summary header */}
      <div className="flex items-center justify-between text-xs text-md-on-surface-variant font-medium">
        <span>
          <span className="font-bold text-md-on-surface">{totalActiveDays}</span> of {daysInMonth} days active in {monthName}
          {consistencyPct > 0 && (
            <span className="text-md-outline font-semibold"> ({consistencyPct}% consistency)</span>
          )}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {/* Weekday Header Row */}
        <div className="grid grid-cols-7 gap-1 sm:gap-2 text-center select-none">
          {SHORT_WEEKDAYS.map((wd) => (
            <div
              key={wd}
              className="text-[11px] font-bold text-md-on-surface-variant/70 uppercase tracking-wider py-1"
            >
              {wd}
            </div>
          ))}
        </div>

        {/* 7-Column Calendar Grid */}
        <div
          className="grid grid-cols-7 gap-1 sm:gap-2 select-none"
          onMouseLeave={() => setHoveredDayKey(null)}
        >
          {/* Empty Offset Days before the 1st of the month */}
          {Array.from({ length: startingDayOfWeek }).map((_, i) => (
            <div
              key={`empty-${i}`}
              className="min-h-[44px] sm:min-h-[58px] rounded-xl sm:rounded-2xl bg-transparent"
            />
          ))}

          {/* Days of the Month */}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const dayNum = i + 1;
            const dateKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
            const bar = dayMap.get(dateKey);
            const sec = bar ? bar.totalSeconds : 0;
            const isSelected = selectedDayKey === dateKey;
            const isToday = dateKey === todayKey;

            return (
              <button
                type="button"
                key={dateKey}
                onMouseEnter={() => setHoveredDayKey(dateKey)}
                onClick={(e) => {
                  e.preventDefault();
                  setSelectedDayKey((prev) => (prev === dateKey ? null : dateKey));
                }}
                className={clsx(
                  'min-h-[46px] sm:min-h-[58px] p-1.5 sm:p-2 rounded-xl sm:rounded-2xl border transition-all duration-150 flex flex-col items-center justify-center text-center sm:items-start sm:justify-between sm:text-left cursor-pointer group select-none relative focus:outline-none',
                  getActivityIntensityStyle(sec, maxDaySeconds, isSelected),
                  isToday && !isSelected && 'ring-2 ring-md-primary/50 border-md-primary/40'
                )}
                aria-label={`${dayNum} ${monthName}: ${sec > 0 ? formatDurationHoursMins(sec) : 'No focus'}`}
              >
                {/* Mobile View: Centered date number and compact duration */}
                <div className="flex sm:hidden flex-col items-center justify-center w-full gap-0.5">
                  <span className={clsx('text-xs font-bold leading-none', isToday && 'text-md-primary font-extrabold')}>
                    {dayNum}
                  </span>
                  {sec > 0 ? (
                    <span className="text-[9px] font-bold text-md-on-surface truncate leading-tight">
                      {formatCompactDuration(sec)}
                    </span>
                  ) : (
                    <span className="text-[8px] opacity-25 leading-none">—</span>
                  )}
                </div>

                {/* Desktop View: Top-left date with bottom duration & sessions */}
                <div className="hidden sm:flex items-center justify-between w-full">
                  <span className={clsx('text-xs font-bold leading-none', isToday && 'text-md-primary font-extrabold')}>
                    {dayNum}
                  </span>
                  {isToday && (
                    <span className="text-[8px] font-extrabold px-1 rounded bg-md-primary/15 text-md-primary leading-tight">
                      TODAY
                    </span>
                  )}
                </div>

                {sec > 0 ? (
                  <div className="hidden sm:flex flex-col w-full mt-1">
                    <span className="text-[11px] font-extrabold truncate leading-tight">
                      {formatCompactDuration(sec)}
                    </span>
                  </div>
                ) : (
                  <div className="hidden sm:block text-[10px] opacity-20">
                    —
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Minimal Status Inspector */}
        <div className="min-h-[28px] mt-2 px-3 py-1.5 rounded-xl bg-md-surface-container/50 border border-md-outline-variant/20 flex items-center justify-between text-xs">
          {inspectedBar ? (
            <div className="flex items-center justify-between w-full">
              <span className="font-bold text-md-on-surface">
                {formatInspectedDate(inspectedBar.key)}
              </span>
              <span className="text-md-on-surface-variant">
                {inspectedBar.totalSeconds > 0 ? (
                  <>
                    <strong className="text-md-primary font-bold">
                      {formatDurationHoursMins(inspectedBar.totalSeconds)}
                    </strong>{' '}
                    ({inspectedBar.sessionCount} {inspectedBar.sessionCount === 1 ? 'session' : 'sessions'})
                  </>
                ) : (
                  <span className="text-md-outline">No focus time logged</span>
                )}
              </span>
            </div>
          ) : (
            <span className="text-md-outline">
              Tap or hover any day to view details
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

import React, { useState, useMemo } from 'react';
import { ActivityBarStat } from '../../hooks/useStatistics';
import { formatDurationHoursMins, formatCompactDuration } from '../../utils/formatters';
import { WEEKDAY_NAMES, MONTH_NAMES, toDateKey } from '../../utils/dates';
import { Calendar as CalendarIcon, BarChart2 } from 'lucide-react';
import { ActivityInspectionCard } from './ActivityInspectionCard';
import { ActivityBarRow } from './ActivityBarRow';
import { clsx } from 'clsx';
import { getActivityIntensityStyle } from './activityUtils';

interface MonthActivityViewProps {
  activityBars: ActivityBarStat[];
}

const SHORT_WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const MonthActivityView: React.FC<MonthActivityViewProps> = ({ activityBars }) => {
  const [displayMode, setDisplayMode] = useState<'calendar' | 'weeks'>('calendar');
  const [hoveredDayKey, setHoveredDayKey] = useState<string | null>(null);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);

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
    // Convert to Monday=0, Tuesday=1, ..., Sunday=6
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

  // Max focus seconds on any single day for color intensity scaling
  const maxDaySeconds = useMemo(() => {
    return Math.max(1, ...activityBars.map((b) => b.totalSeconds));
  }, [activityBars]);

  // Peak day of the month
  const peakDay = useMemo(() => {
    let top: ActivityBarStat | null = null;
    for (const bar of activityBars) {
      if (bar.totalSeconds > 0 && (!top || bar.totalSeconds > top.totalSeconds)) {
        top = bar;
      }
    }
    return top;
  }, [activityBars]);

  // Active days count & total focus
  const totalActiveDays = useMemo(() => {
    return activityBars.filter((b) => b.totalSeconds > 0).length;
  }, [activityBars]);

  const totalFocusSeconds = useMemo(() => {
    return activityBars.reduce((acc, b) => acc + b.totalSeconds, 0);
  }, [activityBars]);

  // Currently inspected day (hovered/selected or null)
  const activeKey = hoveredDayKey || selectedDayKey;
  const inspectedBar = useMemo(() => {
    if (!activeKey) return null;
    return dayMap.get(activeKey) || null;
  }, [activeKey, dayMap]);

  // Group days into Calendar Weeks for the 'weeks' breakdown
  const weeklyGroups = useMemo(() => {
    const weeks: {
      weekIndex: number;
      label: string;
      totalSeconds: number;
      sessionCount: number;
      activeDays: number;
      days: ActivityBarStat[];
    }[] = [];

    let currentWeekDays: ActivityBarStat[] = [];
    let weekCounter = 1;

    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
      const d = new Date(year, monthIndex, dayNum);
      const dow = (d.getDay() + 6) % 7; // Monday = 0, Sunday = 6
      const dateKey = toDateKey(d);
      const bar = dayMap.get(dateKey) || {
        key: dateKey,
        label: String(dayNum),
        totalSeconds: 0,
        hours: 0,
        sessionCount: 0,
      };

      currentWeekDays.push(bar);

      // End of week on Sunday or last day of month
      if (dow === 6 || dayNum === daysInMonth) {
        const startDay = currentWeekDays[0].label;
        const endDay = currentWeekDays[currentWeekDays.length - 1].label;
        const sec = currentWeekDays.reduce((acc, item) => acc + item.totalSeconds, 0);
        const count = currentWeekDays.reduce((acc, item) => acc + item.sessionCount, 0);
        const active = currentWeekDays.filter((item) => item.totalSeconds > 0).length;

        weeks.push({
          weekIndex: weekCounter++,
          label: startDay === endDay ? `${startDay} ${monthName.slice(0, 3)}` : `${startDay}–${endDay} ${monthName.slice(0, 3)}`,
          totalSeconds: sec,
          sessionCount: count,
          activeDays: active,
          days: currentWeekDays,
        });

        currentWeekDays = [];
      }
    }

    return weeks;
  }, [year, monthIndex, daysInMonth, monthName, dayMap]);

  const maxWeekSeconds = useMemo(() => {
    return Math.max(1, ...weeklyGroups.map((w) => w.totalSeconds));
  }, [weeklyGroups]);

  const formatInspectedDate = (dateKey: string) => {
    const [y, m, d] = dateKey.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    const weekday = WEEKDAY_NAMES[dateObj.getDay()];
    return `${weekday}, ${d} ${MONTH_NAMES[m - 1]}`;
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Top Toggle & Summary Subheader */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-md-on-surface-variant font-medium">
          <span className="font-bold text-md-on-surface">{totalActiveDays}</span> of{' '}
          {daysInMonth} days active in {monthName}
          {totalFocusSeconds > 0 && (
            <span className="inline text-xs sm:text-sm text-md-outline">
              {' '}• {formatDurationHoursMins(totalFocusSeconds)} total
            </span>
          )}
        </div>

        {/* Calendar vs Weekly Segmented Toggle */}
        <div className="inline-flex p-0.5 bg-md-surface-container rounded-xl border border-md-outline-variant/30 text-xs">
          <button
            type="button"
            onClick={() => setDisplayMode('calendar')}
            className={clsx(
              'px-2.5 py-1 rounded-lg font-semibold transition-all flex items-center gap-1.5',
              displayMode === 'calendar'
                ? 'bg-md-primary-container text-md-on-primary-container shadow-xs'
                : 'text-md-on-surface-variant hover:text-md-on-surface'
            )}
          >
            <CalendarIcon className="w-3.5 h-3.5" />
            <span>Calendar</span>
          </button>
          <button
            type="button"
            onClick={() => setDisplayMode('weeks')}
            className={clsx(
              'px-2.5 py-1 rounded-lg font-semibold transition-all flex items-center gap-1.5',
              displayMode === 'weeks'
                ? 'bg-md-primary-container text-md-on-primary-container shadow-xs'
                : 'text-md-on-surface-variant hover:text-md-on-surface'
            )}
          >
            <BarChart2 className="w-3.5 h-3.5" />
            <span>Weeks</span>
          </button>
        </div>
      </div>

      {displayMode === 'calendar' ? (
        <div className="flex flex-col gap-2.5">
          {/* Weekday Header Row */}
          <div className="grid grid-cols-7 gap-1 sm:gap-2 text-center select-none">
            {SHORT_WEEKDAYS.map((wd) => (
              <div
                key={wd}
                className="text-[11px] font-bold text-md-on-surface-variant/80 uppercase tracking-wider py-1"
              >
                {wd}
              </div>
            ))}
          </div>

          {/* 7-Column Calendar Grid */}
          <div
            className="grid grid-cols-7 gap-1 sm:gap-2"
            onMouseLeave={() => setHoveredDayKey(null)}
          >
            {/* Empty Offset Days before the 1st of the month */}
            {Array.from({ length: startingDayOfWeek }).map((_, i) => (
              <div
                key={`empty-${i}`}
                className="aspect-square sm:aspect-auto sm:min-h-[62px] rounded-xl sm:rounded-2xl bg-transparent"
              />
            ))}

            {/* Days of the Month */}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const dayNum = i + 1;
              const dateKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
              const bar = dayMap.get(dateKey);
              const sec = bar ? bar.totalSeconds : 0;
              const isSelected = selectedDayKey === dateKey;

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
                    'aspect-square sm:aspect-auto sm:min-h-[64px] p-1 sm:p-2 rounded-xl sm:rounded-2xl border transition-all duration-150 flex flex-col items-center justify-center text-center sm:items-start sm:justify-between sm:text-left cursor-pointer group select-none relative',
                    getActivityIntensityStyle(sec, maxDaySeconds, isSelected)
                  )}
                  aria-label={`${dayNum} ${monthName}: ${sec > 0 ? formatDurationHoursMins(sec) : 'No focus'}`}
                >
                  {/* Mobile View: Centered date number and compact duration */}
                  <div className="flex sm:hidden flex-col items-center justify-center w-full">
                    <span className="text-xs font-bold leading-none">
                      {dayNum}
                    </span>
                    {sec > 0 ? (
                      <span className="text-[9px] font-bold text-md-on-surface truncate leading-tight mt-1">
                        {formatCompactDuration(sec)}
                      </span>
                    ) : (
                      <span className="text-[8px] opacity-25 mt-0.5 leading-none">—</span>
                    )}
                  </div>

                  {/* Desktop View: Top-left date with bottom duration & sessions */}
                  <div className="hidden sm:flex items-center justify-between w-full">
                    <span className="text-sm font-bold leading-none">
                      {dayNum}
                    </span>
                  </div>

                  {sec > 0 ? (
                    <div className="hidden sm:flex flex-col w-full mt-1">
                      <span className="text-[11px] font-extrabold truncate leading-tight">
                        {formatDurationHoursMins(sec)}
                      </span>
                      {bar && bar.sessionCount > 0 && (
                        <span className="text-[9px] opacity-75 truncate leading-tight">
                          {bar.sessionCount} {bar.sessionCount === 1 ? 'session' : 'sessions'}
                        </span>
                      )}
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

          {/* Dynamic Day Inspector Bar */}
          <ActivityInspectionCard
            inspectedBar={inspectedBar}
            peakDay={peakDay}
            formatInspectedDate={formatInspectedDate}
          />
        </div>
      ) : (
        /* Weekly Breakdown Mode */
        <div className="flex flex-col gap-2.5">
          {weeklyGroups.map((week) => (
            <ActivityBarRow
              key={`week-${week.weekIndex}`}
              label={`Week ${week.weekIndex}`}
              subLabel={week.label}
              totalSeconds={week.totalSeconds}
              sessionCount={week.sessionCount}
              maxSeconds={maxWeekSeconds}
            />
          ))}
        </div>
      )}
    </div>
  );
};

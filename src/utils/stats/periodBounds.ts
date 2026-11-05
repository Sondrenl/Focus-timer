import {
  toDateKey,
  MONTH_NAMES,
  getDayRange,
  getWeekRange,
  getMonthRange,
  getYearRange,
  formatFriendlyDate,
} from '../dates';
import { CustomDateRange, PeriodBounds, TimePeriodType } from './types';

/**
 * Computes the previous or next reference date for period navigation,
 * with month-end and leap-year overflow protection.
 */
export function getAdjacentReferenceDate(
  prev: Date,
  periodType: TimePeriodType,
  direction: 'prev' | 'next'
): Date {
  const delta = direction === 'prev' ? -1 : 1;
  const d = new Date(prev);

  if (periodType === 'day') {
    d.setDate(d.getDate() + delta);
  } else if (periodType === 'week') {
    d.setDate(d.getDate() + delta * 7);
  } else if (periodType === 'month') {
    // Setting day to 1 prevents 31st overflow (e.g. March 31 -> Feb 31 -> March 3)
    const targetMonth = d.getMonth() + delta;
    d.setDate(1);
    d.setMonth(targetMonth);
  } else if (periodType === 'year') {
    // Setting day to 1 prevents leap-year Feb 29 overflow
    const targetYear = d.getFullYear() + delta;
    d.setDate(1);
    d.setFullYear(targetYear);
  }

  return d;
}

/**
 * Determines if the user is currently viewing the active time period.
 */
export function checkIsCurrentPeriod(
  periodType: TimePeriodType,
  referenceDate: Date,
  todayKey: string
): boolean {
  const now = new Date(`${todayKey}T12:00:00`);
  if (periodType === 'day') {
    return toDateKey(referenceDate) === todayKey;
  }
  if (periodType === 'week') {
    const { start, end } = getWeekRange(referenceDate);
    return todayKey >= toDateKey(start) && todayKey <= toDateKey(end);
  }
  if (periodType === 'month') {
    return (
      referenceDate.getFullYear() === now.getFullYear() &&
      referenceDate.getMonth() === now.getMonth()
    );
  }
  if (periodType === 'year') {
    return referenceDate.getFullYear() === now.getFullYear();
  }
  return true; // 'all' and 'custom' are static / range-driven
}

/**
 * Determines if forward navigation is permitted (cannot navigate past current period).
 */
export function checkCanGoNext(
  periodType: TimePeriodType,
  referenceDate: Date,
  todayKey: string
): boolean {
  const now = new Date(`${todayKey}T12:00:00`);
  if (periodType === 'all' || periodType === 'custom') return false;
  if (periodType === 'day') {
    return toDateKey(referenceDate) < todayKey;
  }
  if (periodType === 'week') {
    const { end } = getWeekRange(referenceDate);
    return toDateKey(end) < todayKey;
  }
  if (periodType === 'month') {
    if (referenceDate.getFullYear() < now.getFullYear()) return true;
    if (referenceDate.getFullYear() === now.getFullYear()) {
      return referenceDate.getMonth() < now.getMonth();
    }
    return false;
  }
  if (periodType === 'year') {
    return referenceDate.getFullYear() < now.getFullYear();
  }
  return false;
}

/**
 * Computes start/end dates, formatted period label, and sanitized custom range bounds.
 */
export function computePeriodBounds(
  periodType: TimePeriodType,
  referenceDate: Date,
  customRange: CustomDateRange
): PeriodBounds {
  let startDate: Date;
  let endDate: Date;
  let periodLabel = '';

  let sCustomKey = customRange.start;
  let eCustomKey = customRange.end;
  if (sCustomKey > eCustomKey) {
    const tmp = sCustomKey;
    sCustomKey = eCustomKey;
    eCustomKey = tmp;
  }

  if (periodType === 'day') {
    const r = getDayRange(referenceDate);
    startDate = r.start;
    endDate = r.end;
    periodLabel = formatFriendlyDate(referenceDate);
  } else if (periodType === 'week') {
    const r = getWeekRange(referenceDate);
    startDate = r.start;
    endDate = r.end;
    const sStr = `${startDate.getDate()} ${MONTH_NAMES[startDate.getMonth()].slice(0, 3)}`;
    const eStr = `${endDate.getDate()} ${MONTH_NAMES[endDate.getMonth()].slice(0, 3)} ${endDate.getFullYear()}`;
    periodLabel = `${sStr} – ${eStr}`;
  } else if (periodType === 'month') {
    const r = getMonthRange(referenceDate);
    startDate = r.start;
    endDate = r.end;
    periodLabel = `${MONTH_NAMES[startDate.getMonth()]} ${startDate.getFullYear()}`;
  } else if (periodType === 'year') {
    const r = getYearRange(referenceDate);
    startDate = r.start;
    endDate = r.end;
    periodLabel = `${startDate.getFullYear()}`;
  } else if (periodType === 'custom') {
    const s = new Date(`${sCustomKey}T00:00:00.000`);
    const e = new Date(`${eCustomKey}T23:59:59.999`);
    startDate = s;
    endDate = e;
    periodLabel = `${formatFriendlyDate(s, true)} – ${formatFriendlyDate(e, true)}`;
  } else {
    // 'all' time
    startDate = new Date(0);
    endDate = new Date(Date.now() + 86400000 * 365);
    periodLabel = 'All Time History';
  }

  return {
    startDate,
    endDate,
    periodLabel,
    sanitizedCustomRange: { start: sCustomKey, end: eCustomKey },
  };
}

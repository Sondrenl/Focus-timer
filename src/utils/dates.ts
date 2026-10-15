/**
 * Returns formatted date key 'YYYY-MM-DD'
 */
export function toDateKey(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns weekday names (e.g., 'Monday', 'Tuesday')
 */
export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * Returns friendly formatted date with day first, e.g. "Mon, 12 Oct" or "12 Oct 2026"
 */
export function formatFriendlyDate(dateStr: string | Date, includeYear = false): string {
  const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
  const day = d.getDate();
  const month = MONTH_NAMES[d.getMonth()].slice(0, 3);
  const weekday = WEEKDAY_NAMES[d.getDay()].slice(0, 3);
  if (includeYear) {
    return `${day} ${month} ${d.getFullYear()}`;
  }
  return `${weekday}, ${day} ${month}`;
}

/**
 * Returns numeric date in day/month/year format: DD/MM/YYYY
 */
export function formatNumericDate(dateStr: string | Date): string {
  const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Start and end of a single day (00:00:00.000 to 23:59:59.999)
 */
export function getDayRange(ref: Date): { start: Date; end: Date } {
  const start = new Date(ref);
  start.setHours(0, 0, 0, 0);
  const end = new Date(ref);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/**
 * Start and end of an ISO week (Monday to Sunday)
 */
export function getWeekRange(ref: Date): { start: Date; end: Date } {
  const d = new Date(ref);
  const day = d.getDay(); // 0 is Sunday, 1 is Monday
  // Distance to Monday: if day is 0 (Sunday), diff is -6 days; otherwise 1 - day
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const start = new Date(d);
  start.setDate(d.getDate() + diffToMonday);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

/**
 * Start and end of a calendar month
 */
export function getMonthRange(ref: Date): { start: Date; end: Date } {
  const start = new Date(ref.getFullYear(), ref.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

/**
 * Start and end of a calendar year
 */
export function getYearRange(ref: Date): { start: Date; end: Date } {
  const start = new Date(ref.getFullYear(), 0, 1, 0, 0, 0, 0);
  const end = new Date(ref.getFullYear(), 11, 31, 23, 59, 59, 999);
  return { start, end };
}

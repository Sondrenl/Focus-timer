import { describe, it, expect } from 'vitest';
import { toDateKey, formatFriendlyDate, getDayRange, getWeekRange, getMonthRange } from '../src/utils/dates';

describe('Date Utilities and Time Boundaries', () => {
  it('converts Date to invariant YYYY-MM-DD key', () => {
    const d = new Date(2026, 10, 2, 14, 30, 0); // Month is 0-indexed (10 = November)
    expect(toDateKey(d)).toBe('2026-11-02');
  });

  it('formats friendly date strings correctly', () => {
    const formatted = formatFriendlyDate('2026-11-02');
    expect(formatted).toContain('Nov');
    expect(formatted).toContain('2');
  });

  it('computes exact day range boundaries', () => {
    const ref = new Date(2026, 10, 2, 15, 0, 0);
    const { start, end } = getDayRange(ref);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
    expect(end.getSeconds()).toBe(59);
  });

  it('computes week range boundaries starting on Monday', () => {
    const ref = new Date(2026, 10, 4); // Wednesday
    const { start, end } = getWeekRange(ref);
    expect(start.getDay()).toBe(1); // Monday
    expect(end.getDay()).toBe(0); // Sunday
  });

  it('computes month range boundaries covering full month', () => {
    const ref = new Date(2026, 10, 15); // November
    const { start, end } = getMonthRange(ref);
    expect(start.getDate()).toBe(1);
    expect(end.getDate()).toBe(30); // November has 30 days
  });
});

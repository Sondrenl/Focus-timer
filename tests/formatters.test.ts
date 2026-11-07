import { formatTime, formatDurationHoursMins, formatDecimalHours, formatCompactDuration } from '../src/utils/formatters';

describe('Time and Duration Formatters', () => {
  it('formats remaining seconds into MM:SS correctly', () => {
    expect(formatTime(1500)).toBe('25:00');
    expect(formatTime(300)).toBe('05:00');
    expect(formatTime(59)).toBe('00:59');
    expect(formatTime(5)).toBe('00:05');
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(-10)).toBe('00:00');
  });

  it('formats durations into human-friendly hours and minutes', () => {
    expect(formatDurationHoursMins(3600)).toBe('1h');
    expect(formatDurationHoursMins(5400)).toBe('1h 30m');
    expect(formatDurationHoursMins(1500)).toBe('25m');
    expect(formatDurationHoursMins(0)).toBe('0m');
  });

  it('formats decimal hours to 1 decimal place', () => {
    expect(formatDecimalHours(3600)).toBe('1.0');
    expect(formatDecimalHours(5400)).toBe('1.5');
    expect(formatDecimalHours(1800)).toBe('0.5');
  });

  it('formats compact duration for dense mobile calendar cells', () => {
    expect(formatCompactDuration(0)).toBe('0m');
    expect(formatCompactDuration(-10)).toBe('0m');
    expect(formatCompactDuration(300)).toBe('5m');
    expect(formatCompactDuration(2700)).toBe('45m');
    expect(formatCompactDuration(3600)).toBe('1h');
    expect(formatCompactDuration(5400)).toBe('1.5h');
    expect(formatCompactDuration(7200)).toBe('2h');
    expect(formatCompactDuration(8100)).toBe('2.3h');
  });
});

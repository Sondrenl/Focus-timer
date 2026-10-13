/**
 * Formats seconds into mm:ss display string (e.g. 25:00, 04:32)
 */
export function formatTime(seconds: number): string {
  const safeSec = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safeSec / 60);
  const secs = safeSec % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Formats total seconds into human-friendly duration (e.g. "2h 45m" or "35m")
 */
export function formatDurationHoursMins(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0m';
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.round((totalSeconds % 3600) / 60);

  if (hours > 0 && mins > 0) {
    return `${hours}h ${mins}m`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  return `${mins}m`;
}

/**
 * Formats seconds to decimal hours with 1 decimal place (e.g. 4.5 hrs)
 */
export function formatDecimalHours(totalSeconds: number): string {
  const hours = totalSeconds / 3600;
  return hours.toFixed(1);
}

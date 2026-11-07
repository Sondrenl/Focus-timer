import { toDateKey } from './dates';
import { isSampleSessionId } from '../services/repository/SessionRepository';

export const NEW_DAY_HOUR_CUTOFF = 4; // 04:00 AM local time
export const INACTIVITY_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
export const LAST_DAY_RESET_STORAGE_KEY = 'focus_timer_last_day_reset_v1';

/**
 * Returns the logical day key 'YYYY-MM-DD' with a 04:00 AM cutoff.
 * Hours 00:00 - 03:59:59 belong to the previous calendar day.
 * Hours 04:00 - 23:59:59 belong to the current calendar day.
 */
export function getLogicalDayKey(date: Date | number | string): string {
  const d =
    typeof date === 'number' || typeof date === 'string'
      ? new Date(date)
      : new Date(date.getTime());
  if (d.getHours() < NEW_DAY_HOUR_CUTOFF) {
    d.setDate(d.getDate() - 1);
  }
  return toDateKey(d);
}

/**
 * Extracts the latest completedAt timestamp (in ms) from an array of sessions,
 * ignoring seed / sample sessions.
 */
export function getLastSessionCompletedAt(
  sessions: Array<{ id?: string; completedAt: string }> | null | undefined
): number | null {
  if (!sessions || !Array.isArray(sessions) || sessions.length === 0) {
    return null;
  }
  let latest = 0;
  for (const s of sessions) {
    if (!s || !s.completedAt || isSampleSessionId(s.id)) continue;
    const t = new Date(s.completedAt).getTime();
    if (!isNaN(t) && t > latest) {
      latest = t;
    }
  }
  return latest > 0 ? latest : null;
}

/**
 * Reads the latest completed session timestamp directly from localStorage ('sessions_v1').
 */
export function getLastSessionCompletedAtFromStorage(): number | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem('sessions_v1');
    if (!raw) return null;
    const sessions = JSON.parse(raw);
    return getLastSessionCompletedAt(sessions);
  } catch {
    return null;
  }
}

/**
 * Retrieves the stored day key of the last cycle reset from localStorage.
 */
export function getLastResetDayKey(): string | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    return window.localStorage.getItem(LAST_DAY_RESET_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Persists the day key of the last cycle reset to localStorage.
 */
export function setLastResetDayKey(dayKey: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(LAST_DAY_RESET_STORAGE_KEY, dayKey);
  } catch {
    // Storage errors ignored
  }
}

export interface ShouldResetForNewDayParams {
  now?: Date;
  lastSessionTimeMs: number | null;
  lastResetDayKey: string | null;
  isTimerRunning?: boolean;
}

/**
 * Determines whether the timer should reset session indicator dots for a new day.
 * Rules:
 * 1. Timer is not actively running.
 * 2. Current time is after 04:00 (hours >= 4).
 * 3. The user has not had any sessions in the last hour (prevents sudden reset during all-nighters).
 * 4. Only performed once per logical day (if lastResetDayKey === currentLogicalDay, no reset).
 */
export function shouldResetForNewDay({
  now = new Date(),
  lastSessionTimeMs,
  lastResetDayKey,
  isTimerRunning = false,
}: ShouldResetForNewDayParams): boolean {
  // If timer is currently actively running, never reset
  if (isTimerRunning) {
    return false;
  }

  // A new day is defined as being after 04:00
  if (now.getHours() < NEW_DAY_HOUR_CUTOFF) {
    return false;
  }

  const currentLogicalDay = getLogicalDayKey(now);

  // If this logical day has already been reset, perform check once only
  if (lastResetDayKey === currentLogicalDay) {
    return false;
  }

  // Must not have had any sessions in the last hour
  if (lastSessionTimeMs !== null) {
    const timeSinceLastSession = now.getTime() - lastSessionTimeMs;
    if (timeSinceLastSession < INACTIVITY_THRESHOLD_MS) {
      // User worked within the last hour (e.g. all-nighter), do not reset yet
      return false;
    }

    // Edge case: if lastResetDayKey was null (e.g., initial storage/upgrade)
    // but the last session was ALREADY in this current logical day,
    // the user already started today's work, so do not reset mid-day.
    if (lastResetDayKey === null) {
      const lastSessionDayKey = getLogicalDayKey(new Date(lastSessionTimeMs));
      if (lastSessionDayKey === currentLogicalDay) {
        return false;
      }
    }
  }

  return true;
}

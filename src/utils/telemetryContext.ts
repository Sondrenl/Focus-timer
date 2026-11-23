import { DeviceClass, SettingsSnapshot } from '../types/telemetry';
import { UserSettings } from '../types/settings';
import { isMobileDevice } from './environment';

export interface LocalTimeContext {
  timestamp: string;
  timestampMs: number;
  utcOffsetMinutes: number;
  ianaTimezone?: string;
  localDate: string; // YYYY-MM-DD
  localHour: number; // 0..23
  localMinuteOfDay: number; // 0..1439
  localDayOfWeek: number; // 0..6 (Sunday = 0)
}

/**
 * Extracts local wall-clock & timezone metadata from a timestamp without using any cookies.
 * Note: utcOffsetMinutes uses standard positive-east convention (e.g. UTC+1 = +60, UTC-5 = -300).
 */
export function buildLocalTimeContext(dateOrMs: Date | number = new Date()): LocalTimeContext {
  const d = typeof dateOrMs === 'number' ? new Date(dateOrMs) : dateOrMs;
  const timestampMs = d.getTime();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const localHour = d.getHours();
  const localMinuteOfDay = localHour * 60 + d.getMinutes();

  let ianaTimezone: string | undefined;
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && typeof tz === 'string' && tz.length <= 64) {
      ianaTimezone = tz;
    }
  } catch {
    ianaTimezone = undefined;
  }

  return {
    timestamp: d.toISOString(),
    timestampMs,
    utcOffsetMinutes: -d.getTimezoneOffset(),
    ianaTimezone,
    localDate: `${year}-${month}-${day}`,
    localHour,
    localMinuteOfDay,
    localDayOfWeek: d.getDay(),
  };
}

export function getDeviceClass(): DeviceClass {
  return isMobileDevice() ? 'mobile' : 'desktop';
}

export function buildSettingsSnapshot(settings: UserSettings): SettingsSnapshot {
  return {
    workDurationMinutes: settings.workDurationMinutes,
    shortBreakDurationMinutes: settings.shortBreakDurationMinutes,
    longBreakDurationMinutes: settings.longBreakDurationMinutes,
    longBreakInterval: settings.longBreakInterval,
    autoStartBreaks: settings.autoStartBreaks,
    autoStartPomodoros: settings.autoStartPomodoros,
  };
}

/**
 * Minimum active elapsed seconds required before an aborted run (skip/reset/switch)
 * is recorded in ML telemetry.
 * - Intervals > 2 minutes: 30 seconds cutoff.
 * - Intervals <= 2 minutes: 1/4 of plannedDurationSeconds (e.g. 120s -> 30s, 60s -> 15s).
 */
export function getMinimumAbortTelemetrySeconds(plannedDurationSeconds: number): number {
  const safePlanned = Math.max(1, plannedDurationSeconds);
  return safePlanned <= 120 ? safePlanned / 4 : 30;
}

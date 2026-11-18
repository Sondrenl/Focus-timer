import { DeviceClass, SettingsSnapshot } from '../types/telemetry';
import { UserSettings } from '../types/settings';
import { CoffeeCup } from '../types/coffee';
import { SessionAttempt } from '../types/telemetry';
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

export interface CoffeeContextMetrics {
  coffeeCupsToday: number;
  minutesSinceLastCoffee: number | null;
}

/**
 * Computes daily coffee count and minutes since the most recent cup at a given reference timestamp.
 */
export function computeCoffeeContextAt(
  coffeeCups: CoffeeCup[],
  localDate: string,
  referenceMs: number
): CoffeeContextMetrics {
  let coffeeCupsToday = 0;
  let latestCupMs: number | null = null;

  for (const cup of coffeeCups) {
    const cupMs = Date.parse(cup.createdAt);
    const isAtOrBeforeRef = Number.isNaN(cupMs) || cupMs <= referenceMs;
    if (cup.date === localDate && isAtOrBeforeRef) {
      coffeeCupsToday += 1;
    }
    if (!Number.isNaN(cupMs) && cupMs <= referenceMs) {
      if (latestCupMs === null || cupMs > latestCupMs) {
        latestCupMs = cupMs;
      }
    }
  }

  const minutesSinceLastCoffee =
    latestCupMs !== null ? Math.max(0, Math.round((referenceMs - latestCupMs) / 60000)) : null;

  return {
    coffeeCupsToday,
    minutesSinceLastCoffee,
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

export interface PriorAttemptContextMetrics {
  timeSincePreviousAttemptSeconds: number | null;
  previousAttemptType: SessionAttempt['sessionType'] | null;
  previousAttemptOutcome: SessionAttempt['status'] extends infer S
    ? Exclude<S, 'in_progress'> | null
    : never;
  workSessionsCompletedToday: number;
  workActiveSecondsToday: number;
  skipsToday: number;
}

/**
 * Computes fatigue, momentum, and gap features from prior finalized attempts on the same localDate.
 */
export function computePriorAttemptContext(
  attempts: SessionAttempt[],
  localDate: string,
  referenceMs: number
): PriorAttemptContextMetrics {
  let latestEndedMs: number | null = null;
  let previousAttemptType: PriorAttemptContextMetrics['previousAttemptType'] = null;
  let previousAttemptOutcome: PriorAttemptContextMetrics['previousAttemptOutcome'] = null;
  let workSessionsCompletedToday = 0;
  let workActiveSecondsToday = 0;
  let skipsToday = 0;

  for (const att of attempts) {
    if (att.status === 'in_progress' || !att.wasStarted) continue;

    if (att.localDate === localDate) {
      if (att.sessionType === 'WORK' && att.status === 'completed') {
        workSessionsCompletedToday += 1;
      }
      if (att.sessionType === 'WORK') {
        workActiveSecondsToday += Math.max(0, att.actualActiveSeconds);
      }
      if (att.status === 'skipped') {
        skipsToday += 1;
      }
    }

    if (att.endedAt) {
      const endMs = Date.parse(att.endedAt);
      if (!Number.isNaN(endMs) && endMs <= referenceMs) {
        if (latestEndedMs === null || endMs > latestEndedMs) {
          latestEndedMs = endMs;
          previousAttemptType = att.sessionType;
          previousAttemptOutcome = att.status;
        }
      }
    }
  }

  const timeSincePreviousAttemptSeconds =
    latestEndedMs !== null ? Math.max(0, Math.round((referenceMs - latestEndedMs) / 1000)) : null;

  return {
    timeSincePreviousAttemptSeconds,
    previousAttemptType,
    previousAttemptOutcome,
    workSessionsCompletedToday,
    workActiveSecondsToday,
    skipsToday,
  };
}

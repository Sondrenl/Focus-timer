import { SessionType } from '../types/timer';
import { UserSettings } from '../types/settings';

export interface NextIntervalResult {
  nextType: SessionType;
  nextCycle: number;
  nextDuration: number;
  shouldAutoStart: boolean;
}

export interface PreviousIntervalResult {
  previousType: SessionType;
  previousCycle: number;
  previousDuration: number;
}

/**
 * Calculates duration in seconds for a given session type according to user preferences.
 */
export function getDurationForType(type: SessionType, settings: UserSettings): number {
  switch (type) {
    case 'WORK':
      return Math.max(1, Math.round(settings.workDurationMinutes * 60));
    case 'SHORT_BREAK':
      return Math.max(1, Math.round(settings.shortBreakDurationMinutes * 60));
    case 'LONG_BREAK':
      return Math.max(1, Math.round(settings.longBreakDurationMinutes * 60));
  }
}

/**
 * Pure state machine transition logic for Pomodoro cycles.
 * - Work interval (cycle < longBreakInterval) -> Short Break (same cycle)
 * - Work interval (cycle >= longBreakInterval) -> Long Break (same cycle)
 * - Short Break -> Work (cycle + 1)
 * - Long Break -> Work (cycle resets to 1)
 */
export function computeNextInterval(
  completedType: SessionType,
  currentCycle: number,
  settings: UserSettings
): NextIntervalResult {
  let nextType: SessionType;
  let nextCycle = currentCycle;

  if (completedType === 'WORK') {
    if (currentCycle >= settings.longBreakInterval) {
      nextType = 'LONG_BREAK';
      nextCycle = currentCycle;
    } else {
      nextType = 'SHORT_BREAK';
      nextCycle = currentCycle;
    }
  } else if (completedType === 'SHORT_BREAK') {
    nextType = 'WORK';
    nextCycle = currentCycle + 1;
  } else {
    // LONG_BREAK completed
    nextType = 'WORK';
    nextCycle = 1;
  }

  const nextDuration = getDurationForType(nextType, settings);
  const shouldAutoStart =
    nextType === 'WORK'
      ? settings.autoStartPomodoros
      : settings.autoStartBreaks;

  return {
    nextType,
    nextCycle,
    nextDuration,
    shouldAutoStart,
  };
}

/**
 * State machine transition logic for stepping backward in the Pomodoro cycle.
 * - From WORK (cycle 1): previous is LONG_BREAK (cycle settings.longBreakInterval)
 * - From WORK (cycle N > 1): previous is SHORT_BREAK (cycle N - 1)
 * - From SHORT_BREAK (cycle N): previous is WORK (cycle N)
 * - From LONG_BREAK (cycle N): previous is WORK (cycle N)
 */
export function computePreviousInterval(
  currentType: SessionType,
  currentCycle: number,
  settings: UserSettings
): PreviousIntervalResult {
  let previousType: SessionType;
  let previousCycle: number;

  if (currentType === 'WORK') {
    if (currentCycle <= 1) {
      previousType = 'LONG_BREAK';
      previousCycle = settings.longBreakInterval;
    } else {
      previousType = 'SHORT_BREAK';
      previousCycle = currentCycle - 1;
    }
  } else if (currentType === 'SHORT_BREAK') {
    previousType = 'WORK';
    previousCycle = currentCycle;
  } else {
    // LONG_BREAK
    previousType = 'WORK';
    previousCycle = currentCycle;
  }

  const previousDuration = getDurationForType(previousType, settings);

  return {
    previousType,
    previousCycle,
    previousDuration,
  };
}


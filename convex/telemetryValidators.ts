import { v, Infer } from "convex/values";

export const ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;
export const TAG_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
export const LOCAL_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const sessionTypeValidator = v.union(
  v.literal("WORK"),
  v.literal("SHORT_BREAK"),
  v.literal("LONG_BREAK")
);

export const timerStatusValidator = v.union(
  v.literal("IDLE"),
  v.literal("RUNNING"),
  v.literal("PAUSED"),
  v.literal("COMPLETED")
);

export const deviceClassValidator = v.union(
  v.literal("desktop"),
  v.literal("mobile")
);

export const attemptOutcomeValidator = v.union(
  v.literal("completed"),
  v.literal("skipped"),
  v.literal("reset"),
  v.literal("switched"),
  v.literal("abandoned_stale")
);

export const attemptStatusValidator = v.union(
  v.literal("in_progress"),
  v.literal("completed"),
  v.literal("skipped"),
  v.literal("reset"),
  v.literal("switched"),
  v.literal("abandoned_stale")
);

export const telemetrySourceValidator = v.union(
  v.literal("client"),
  v.literal("server_scheduled")
);

export const mlEventTypeValidator = v.union(
  v.literal("session_started"),
  v.literal("session_paused"),
  v.literal("session_resumed"),
  v.literal("session_completed"),
  v.literal("session_skipped"),
  v.literal("session_reset"),
  v.literal("session_switched"),
  v.literal("session_abandoned_stale"),
  v.literal("tag_changed"),
  v.literal("settings_changed"),
  v.literal("daily_goal_changed"),
  v.literal("coffee_logged"),
  v.literal("coffee_removed")
);

export const pauseIntervalDbValidator = v.object({
  pausedAt: v.string(),
  resumedAt: v.optional(v.string()),
  durationSeconds: v.optional(v.number()),
  elapsedActiveSecondsAtPause: v.number(),
  remainingSecondsAtPause: v.number(),
});

export const pauseIntervalInputValidator = v.object({
  pausedAt: v.string(),
  resumedAt: v.optional(v.union(v.string(), v.null())),
  durationSeconds: v.optional(v.union(v.number(), v.null())),
  elapsedActiveSecondsAtPause: v.number(),
  remainingSecondsAtPause: v.number(),
});

export const settingsSnapshotValidator = v.object({
  workDurationMinutes: v.number(),
  shortBreakDurationMinutes: v.number(),
  longBreakDurationMinutes: v.number(),
  longBreakInterval: v.number(),
  autoStartBreaks: v.boolean(),
  autoStartPomodoros: v.boolean(),
});

export const partialSettingsSnapshotValidator = v.object({
  workDurationMinutes: v.optional(v.number()),
  shortBreakDurationMinutes: v.optional(v.number()),
  longBreakDurationMinutes: v.optional(v.number()),
  longBreakInterval: v.optional(v.number()),
  autoStartBreaks: v.optional(v.boolean()),
  autoStartPomodoros: v.optional(v.boolean()),
});

export const sessionAttemptDbFields = {
  attemptId: v.string(),
  sessionType: sessionTypeValidator,
  status: attemptStatusValidator,
  wasStarted: v.boolean(),
  plannedDurationSeconds: v.number(),
  actualActiveSeconds: v.number(),
  remainingSecondsAtEnd: v.number(),
  completionRatio: v.number(),
  startedAt: v.optional(v.string()),
  endedAt: v.optional(v.string()),
  utcOffsetMinutes: v.number(),
  ianaTimezone: v.optional(v.string()),
  localDate: v.string(),
  localHour: v.number(),
  localMinuteOfDay: v.number(),
  localDayOfWeek: v.number(),
  cycleIndex: v.number(),
  longBreakInterval: v.number(),
  autoStarted: v.boolean(),
  initialTagId: v.optional(v.string()),
  tagId: v.optional(v.string()),
  tagChangedMidRun: v.boolean(),
  pauseCount: v.number(),
  totalPausedSeconds: v.number(),
  pauseIntervals: v.array(pauseIntervalDbValidator),
  timeSincePreviousAttemptSeconds: v.optional(v.number()),
  previousAttemptType: v.optional(sessionTypeValidator),
  previousAttemptOutcome: v.optional(attemptOutcomeValidator),
  workSessionsCompletedToday: v.number(),
  workActiveSecondsToday: v.number(),
  skipsToday: v.number(),
  coffeeCupsTodayAtStart: v.number(),
  minutesSinceLastCoffeeAtStart: v.optional(v.number()),
  coffeeLoggedDuringRun: v.number(),
  dailyGoalMinutes: v.number(),
  settingsSnapshot: settingsSnapshotValidator,
  deviceClass: deviceClassValidator,
  tabBackgroundedCount: v.number(),
  completionLatencySeconds: v.optional(v.number()),
  source: telemetrySourceValidator,
  updatedAtMs: v.number(),
};

export const sessionAttemptInputFields = {
  attemptId: v.string(),
  sessionType: sessionTypeValidator,
  status: attemptStatusValidator,
  wasStarted: v.boolean(),
  plannedDurationSeconds: v.number(),
  actualActiveSeconds: v.number(),
  remainingSecondsAtEnd: v.number(),
  completionRatio: v.number(),
  startedAt: v.optional(v.union(v.string(), v.null())),
  endedAt: v.optional(v.union(v.string(), v.null())),
  utcOffsetMinutes: v.number(),
  ianaTimezone: v.optional(v.union(v.string(), v.null())),
  localDate: v.string(),
  localHour: v.number(),
  localMinuteOfDay: v.number(),
  localDayOfWeek: v.number(),
  cycleIndex: v.number(),
  longBreakInterval: v.number(),
  autoStarted: v.boolean(),
  initialTagId: v.optional(v.union(v.string(), v.null())),
  tagId: v.optional(v.union(v.string(), v.null())),
  tagChangedMidRun: v.boolean(),
  pauseCount: v.number(),
  totalPausedSeconds: v.number(),
  pauseIntervals: v.array(pauseIntervalInputValidator),
  timeSincePreviousAttemptSeconds: v.optional(v.union(v.number(), v.null())),
  previousAttemptType: v.optional(v.union(sessionTypeValidator, v.null())),
  previousAttemptOutcome: v.optional(v.union(attemptOutcomeValidator, v.null())),
  workSessionsCompletedToday: v.number(),
  workActiveSecondsToday: v.number(),
  skipsToday: v.number(),
  coffeeCupsTodayAtStart: v.number(),
  minutesSinceLastCoffeeAtStart: v.optional(v.union(v.number(), v.null())),
  coffeeLoggedDuringRun: v.number(),
  dailyGoalMinutes: v.number(),
  settingsSnapshot: settingsSnapshotValidator,
  deviceClass: deviceClassValidator,
  tabBackgroundedCount: v.number(),
  completionLatencySeconds: v.optional(v.union(v.number(), v.null())),
  source: telemetrySourceValidator,
  updatedAtMs: v.number(),
};

export const sessionAttemptInputValidator = v.object(sessionAttemptInputFields);

export const sessionAttemptReturnValidator = v.object({
  attemptId: v.string(),
  sessionType: sessionTypeValidator,
  status: attemptStatusValidator,
  wasStarted: v.boolean(),
  plannedDurationSeconds: v.number(),
  actualActiveSeconds: v.number(),
  remainingSecondsAtEnd: v.number(),
  completionRatio: v.number(),
  startedAt: v.union(v.string(), v.null()),
  endedAt: v.union(v.string(), v.null()),
  utcOffsetMinutes: v.number(),
  ianaTimezone: v.optional(v.string()),
  localDate: v.string(),
  localHour: v.number(),
  localMinuteOfDay: v.number(),
  localDayOfWeek: v.number(),
  cycleIndex: v.number(),
  longBreakInterval: v.number(),
  autoStarted: v.boolean(),
  initialTagId: v.union(v.string(), v.null()),
  tagId: v.union(v.string(), v.null()),
  tagChangedMidRun: v.boolean(),
  pauseCount: v.number(),
  totalPausedSeconds: v.number(),
  pauseIntervals: v.array(pauseIntervalDbValidator),
  timeSincePreviousAttemptSeconds: v.union(v.number(), v.null()),
  previousAttemptType: v.union(sessionTypeValidator, v.null()),
  previousAttemptOutcome: v.union(attemptOutcomeValidator, v.null()),
  workSessionsCompletedToday: v.number(),
  workActiveSecondsToday: v.number(),
  skipsToday: v.number(),
  coffeeCupsTodayAtStart: v.number(),
  minutesSinceLastCoffeeAtStart: v.union(v.number(), v.null()),
  coffeeLoggedDuringRun: v.number(),
  dailyGoalMinutes: v.number(),
  settingsSnapshot: settingsSnapshotValidator,
  deviceClass: deviceClassValidator,
  tabBackgroundedCount: v.number(),
  completionLatencySeconds: v.union(v.number(), v.null()),
  source: telemetrySourceValidator,
  updatedAtMs: v.number(),
});

export const mlEventDbFields = {
  eventId: v.string(),
  eventType: mlEventTypeValidator,
  timestamp: v.string(),
  timestampMs: v.number(),
  utcOffsetMinutes: v.number(),
  ianaTimezone: v.optional(v.string()),
  localDate: v.string(),
  localHour: v.number(),
  localMinuteOfDay: v.number(),
  localDayOfWeek: v.number(),
  deviceClass: deviceClassValidator,
  attemptId: v.optional(v.string()),
  sessionType: v.optional(sessionTypeValidator),
  tagId: v.optional(v.string()),
  plannedDurationSeconds: v.optional(v.number()),
  elapsedActiveSeconds: v.optional(v.number()),
  remainingSeconds: v.optional(v.number()),
  pauseDurationSeconds: v.optional(v.number()),
  fromTagId: v.optional(v.string()),
  toTagId: v.optional(v.string()),
  toSessionType: v.optional(sessionTypeValidator),
  autoStarted: v.optional(v.boolean()),
  cupId: v.optional(v.string()),
  cupDate: v.optional(v.string()),
  cupIndexToday: v.optional(v.number()),
  minutesSincePreviousCup: v.optional(v.number()),
  minutesSinceLastWorkEnd: v.optional(v.number()),
  activeTimerStatus: v.optional(timerStatusValidator),
  changedFields: v.optional(v.array(v.string())),
  previousSettings: v.optional(partialSettingsSnapshotValidator),
  newSettings: v.optional(partialSettingsSnapshotValidator),
  previousDailyGoalMinutes: v.optional(v.number()),
  newDailyGoalMinutes: v.optional(v.number()),
  source: v.optional(telemetrySourceValidator),
};

export const mlEventInputFields = {
  eventId: v.string(),
  eventType: mlEventTypeValidator,
  timestamp: v.string(),
  timestampMs: v.number(),
  utcOffsetMinutes: v.number(),
  ianaTimezone: v.optional(v.union(v.string(), v.null())),
  localDate: v.string(),
  localHour: v.number(),
  localMinuteOfDay: v.number(),
  localDayOfWeek: v.number(),
  deviceClass: deviceClassValidator,
  attemptId: v.optional(v.union(v.string(), v.null())),
  sessionType: v.optional(v.union(sessionTypeValidator, v.null())),
  tagId: v.optional(v.union(v.string(), v.null())),
  plannedDurationSeconds: v.optional(v.union(v.number(), v.null())),
  elapsedActiveSeconds: v.optional(v.union(v.number(), v.null())),
  remainingSeconds: v.optional(v.union(v.number(), v.null())),
  pauseDurationSeconds: v.optional(v.union(v.number(), v.null())),
  fromTagId: v.optional(v.union(v.string(), v.null())),
  toTagId: v.optional(v.union(v.string(), v.null())),
  toSessionType: v.optional(v.union(sessionTypeValidator, v.null())),
  autoStarted: v.optional(v.union(v.boolean(), v.null())),
  cupId: v.optional(v.union(v.string(), v.null())),
  cupDate: v.optional(v.union(v.string(), v.null())),
  cupIndexToday: v.optional(v.union(v.number(), v.null())),
  minutesSincePreviousCup: v.optional(v.union(v.number(), v.null())),
  minutesSinceLastWorkEnd: v.optional(v.union(v.number(), v.null())),
  activeTimerStatus: v.optional(v.union(timerStatusValidator, v.null())),
  changedFields: v.optional(v.union(v.array(v.string()), v.null())),
  previousSettings: v.optional(v.union(partialSettingsSnapshotValidator, v.null())),
  newSettings: v.optional(v.union(partialSettingsSnapshotValidator, v.null())),
  previousDailyGoalMinutes: v.optional(v.union(v.number(), v.null())),
  newDailyGoalMinutes: v.optional(v.union(v.number(), v.null())),
  source: v.optional(v.union(telemetrySourceValidator, v.null())),
};

export const mlEventInputValidator = v.object(mlEventInputFields);

export const mlEventReturnValidator = v.object({
  eventId: v.string(),
  eventType: mlEventTypeValidator,
  timestamp: v.string(),
  timestampMs: v.number(),
  utcOffsetMinutes: v.number(),
  ianaTimezone: v.optional(v.string()),
  localDate: v.string(),
  localHour: v.number(),
  localMinuteOfDay: v.number(),
  localDayOfWeek: v.number(),
  deviceClass: deviceClassValidator,
  attemptId: v.optional(v.union(v.string(), v.null())),
  sessionType: v.optional(v.union(sessionTypeValidator, v.null())),
  tagId: v.optional(v.union(v.string(), v.null())),
  plannedDurationSeconds: v.optional(v.union(v.number(), v.null())),
  elapsedActiveSeconds: v.optional(v.union(v.number(), v.null())),
  remainingSeconds: v.optional(v.union(v.number(), v.null())),
  pauseDurationSeconds: v.optional(v.union(v.number(), v.null())),
  fromTagId: v.optional(v.union(v.string(), v.null())),
  toTagId: v.optional(v.union(v.string(), v.null())),
  toSessionType: v.optional(v.union(sessionTypeValidator, v.null())),
  autoStarted: v.optional(v.union(v.boolean(), v.null())),
  cupId: v.optional(v.union(v.string(), v.null())),
  cupDate: v.optional(v.union(v.string(), v.null())),
  cupIndexToday: v.optional(v.union(v.number(), v.null())),
  minutesSincePreviousCup: v.optional(v.union(v.number(), v.null())),
  minutesSinceLastWorkEnd: v.optional(v.union(v.number(), v.null())),
  activeTimerStatus: v.optional(v.union(timerStatusValidator, v.null())),
  changedFields: v.optional(v.union(v.array(v.string()), v.null())),
  previousSettings: v.optional(v.union(partialSettingsSnapshotValidator, v.null())),
  newSettings: v.optional(v.union(partialSettingsSnapshotValidator, v.null())),
  previousDailyGoalMinutes: v.optional(v.union(v.number(), v.null())),
  newDailyGoalMinutes: v.optional(v.union(v.number(), v.null())),
  source: v.optional(v.union(telemetrySourceValidator, v.null())),
});

export type SessionAttemptInput = Infer<typeof sessionAttemptInputValidator>;
export type MlEventInput = Infer<typeof mlEventInputValidator>;

const sessionAttemptDbObjectValidator = v.object(sessionAttemptDbFields);
const mlEventDbObjectValidator = v.object(mlEventDbFields);
export type SessionAttemptDbDoc = Infer<typeof sessionAttemptDbObjectValidator>;
export type MlEventDbDoc = Infer<typeof mlEventDbObjectValidator>;

function isFiniteInRange(val: number, min: number, max: number): boolean {
  return Number.isFinite(val) && val >= min && val <= max;
}

function isValidIsoString(val: string): boolean {
  return val.length > 0 && val.length <= 64 && !Number.isNaN(Date.parse(val));
}

export function validateAndNormalizeAttempt(
  input: SessionAttemptInput
): { ok: true; value: SessionAttemptDbDoc } | { ok: false; error: string } {
  if (!ID_REGEX.test(input.attemptId)) {
    return { ok: false, error: "Invalid attemptId format." };
  }
  if (!LOCAL_DATE_REGEX.test(input.localDate)) {
    return { ok: false, error: "Invalid localDate format: must be YYYY-MM-DD." };
  }
  if (!isFiniteInRange(input.plannedDurationSeconds, 1, 86400)) {
    return { ok: false, error: "plannedDurationSeconds must be between 1 and 86400." };
  }
  if (!isFiniteInRange(input.actualActiveSeconds, 0, 86400 * 7)) {
    return { ok: false, error: "actualActiveSeconds must be between 0 and 604800." };
  }
  if (!isFiniteInRange(input.remainingSecondsAtEnd, 0, 86400)) {
    return { ok: false, error: "remainingSecondsAtEnd must be between 0 and 86400." };
  }
  if (!isFiniteInRange(input.completionRatio, 0, 2)) {
    return { ok: false, error: "completionRatio must be between 0 and 2." };
  }
  if (!isFiniteInRange(input.utcOffsetMinutes, -840, 840)) {
    return { ok: false, error: "utcOffsetMinutes must be between -840 and 840." };
  }
  if (!isFiniteInRange(input.localHour, 0, 23)) {
    return { ok: false, error: "localHour must be between 0 and 23." };
  }
  if (!isFiniteInRange(input.localMinuteOfDay, 0, 1439)) {
    return { ok: false, error: "localMinuteOfDay must be between 0 and 1439." };
  }
  if (!isFiniteInRange(input.localDayOfWeek, 0, 6)) {
    return { ok: false, error: "localDayOfWeek must be between 0 and 6." };
  }
  if (!isFiniteInRange(input.cycleIndex, 0, 1000)) {
    return { ok: false, error: "cycleIndex must be between 0 and 1000." };
  }
  if (!isFiniteInRange(input.longBreakInterval, 1, 100)) {
    return { ok: false, error: "longBreakInterval must be between 1 and 100." };
  }
  if (!isFiniteInRange(input.pauseCount, 0, 10000)) {
    return { ok: false, error: "pauseCount must be between 0 and 10000." };
  }
  if (!isFiniteInRange(input.totalPausedSeconds, 0, 86400 * 7)) {
    return { ok: false, error: "totalPausedSeconds must be between 0 and 604800." };
  }
  if (input.pauseIntervals.length > 50) {
    return { ok: false, error: "pauseIntervals cannot exceed 50 items." };
  }

  const normalizedPauses: SessionAttemptDbDoc["pauseIntervals"] = [];
  for (const p of input.pauseIntervals) {
    if (!isValidIsoString(p.pausedAt)) {
      return { ok: false, error: "Invalid pauseInterval pausedAt timestamp." };
    }
    if (p.resumedAt !== undefined && p.resumedAt !== null && !isValidIsoString(p.resumedAt)) {
      return { ok: false, error: "Invalid pauseInterval resumedAt timestamp." };
    }
    if (
      p.durationSeconds !== undefined &&
      p.durationSeconds !== null &&
      !isFiniteInRange(p.durationSeconds, 0, 86400 * 7)
    ) {
      return { ok: false, error: "Invalid pauseInterval durationSeconds." };
    }
    if (!isFiniteInRange(p.elapsedActiveSecondsAtPause, 0, 86400 * 7)) {
      return { ok: false, error: "Invalid pauseInterval elapsedActiveSecondsAtPause." };
    }
    if (!isFiniteInRange(p.remainingSecondsAtPause, 0, 86400)) {
      return { ok: false, error: "Invalid pauseInterval remainingSecondsAtPause." };
    }
    normalizedPauses.push({
      pausedAt: p.pausedAt,
      resumedAt: p.resumedAt ?? undefined,
      durationSeconds: p.durationSeconds ?? undefined,
      elapsedActiveSecondsAtPause: p.elapsedActiveSecondsAtPause,
      remainingSecondsAtPause: p.remainingSecondsAtPause,
    });
  }

  if (input.startedAt && !isValidIsoString(input.startedAt)) {
    return { ok: false, error: "Invalid startedAt timestamp." };
  }
  if (input.endedAt && !isValidIsoString(input.endedAt)) {
    return { ok: false, error: "Invalid endedAt timestamp." };
  }
  if (input.ianaTimezone && input.ianaTimezone.length > 100) {
    return { ok: false, error: "ianaTimezone exceeds maximum length." };
  }
  if (input.initialTagId && !TAG_ID_REGEX.test(input.initialTagId)) {
    return { ok: false, error: "Invalid initialTagId format." };
  }
  if (input.tagId && !TAG_ID_REGEX.test(input.tagId)) {
    return { ok: false, error: "Invalid tagId format." };
  }
  if (
    input.timeSincePreviousAttemptSeconds !== undefined &&
    input.timeSincePreviousAttemptSeconds !== null &&
    !isFiniteInRange(input.timeSincePreviousAttemptSeconds, 0, 86400 * 365)
  ) {
    return { ok: false, error: "Invalid timeSincePreviousAttemptSeconds." };
  }
  if (!isFiniteInRange(input.workSessionsCompletedToday, 0, 1000)) {
    return { ok: false, error: "Invalid workSessionsCompletedToday." };
  }
  if (!isFiniteInRange(input.workActiveSecondsToday, 0, 86400 * 7)) {
    return { ok: false, error: "Invalid workActiveSecondsToday." };
  }
  if (!isFiniteInRange(input.skipsToday, 0, 1000)) {
    return { ok: false, error: "Invalid skipsToday." };
  }
  if (!isFiniteInRange(input.coffeeCupsTodayAtStart, 0, 200)) {
    return { ok: false, error: "Invalid coffeeCupsTodayAtStart." };
  }
  if (
    input.minutesSinceLastCoffeeAtStart !== undefined &&
    input.minutesSinceLastCoffeeAtStart !== null &&
    !isFiniteInRange(input.minutesSinceLastCoffeeAtStart, 0, 60 * 24 * 365)
  ) {
    return { ok: false, error: "Invalid minutesSinceLastCoffeeAtStart." };
  }
  if (!isFiniteInRange(input.coffeeLoggedDuringRun, 0, 200)) {
    return { ok: false, error: "Invalid coffeeLoggedDuringRun." };
  }
  if (!isFiniteInRange(input.dailyGoalMinutes, 0, 1440)) {
    return { ok: false, error: "Invalid dailyGoalMinutes." };
  }
  if (!isFiniteInRange(input.tabBackgroundedCount, 0, 100000)) {
    return { ok: false, error: "Invalid tabBackgroundedCount." };
  }
  if (
    input.completionLatencySeconds !== undefined &&
    input.completionLatencySeconds !== null &&
    !isFiniteInRange(input.completionLatencySeconds, 0, 86400 * 7)
  ) {
    return { ok: false, error: "Invalid completionLatencySeconds." };
  }
  if (!Number.isFinite(input.updatedAtMs) || input.updatedAtMs < 0) {
    return { ok: false, error: "Invalid updatedAtMs." };
  }

  const ss = input.settingsSnapshot;
  if (
    !isFiniteInRange(ss.workDurationMinutes, 1, 360) ||
    !isFiniteInRange(ss.shortBreakDurationMinutes, 1, 360) ||
    !isFiniteInRange(ss.longBreakDurationMinutes, 1, 360) ||
    !isFiniteInRange(ss.longBreakInterval, 1, 100)
  ) {
    return { ok: false, error: "Invalid settingsSnapshot values." };
  }

  return {
    ok: true,
    value: {
      attemptId: input.attemptId,
      sessionType: input.sessionType,
      status: input.status,
      wasStarted: input.wasStarted,
      plannedDurationSeconds: input.plannedDurationSeconds,
      actualActiveSeconds: input.actualActiveSeconds,
      remainingSecondsAtEnd: input.remainingSecondsAtEnd,
      completionRatio: input.completionRatio,
      startedAt: input.startedAt || undefined,
      endedAt: input.endedAt || undefined,
      utcOffsetMinutes: input.utcOffsetMinutes,
      ianaTimezone: input.ianaTimezone || undefined,
      localDate: input.localDate,
      localHour: input.localHour,
      localMinuteOfDay: input.localMinuteOfDay,
      localDayOfWeek: input.localDayOfWeek,
      cycleIndex: input.cycleIndex,
      longBreakInterval: input.longBreakInterval,
      autoStarted: input.autoStarted,
      initialTagId: input.initialTagId || undefined,
      tagId: input.tagId || undefined,
      tagChangedMidRun: input.tagChangedMidRun,
      pauseCount: input.pauseCount,
      totalPausedSeconds: input.totalPausedSeconds,
      pauseIntervals: normalizedPauses,
      timeSincePreviousAttemptSeconds: input.timeSincePreviousAttemptSeconds ?? undefined,
      previousAttemptType: input.previousAttemptType ?? undefined,
      previousAttemptOutcome: input.previousAttemptOutcome ?? undefined,
      workSessionsCompletedToday: input.workSessionsCompletedToday,
      workActiveSecondsToday: input.workActiveSecondsToday,
      skipsToday: input.skipsToday,
      coffeeCupsTodayAtStart: input.coffeeCupsTodayAtStart,
      minutesSinceLastCoffeeAtStart: input.minutesSinceLastCoffeeAtStart ?? undefined,
      coffeeLoggedDuringRun: input.coffeeLoggedDuringRun,
      dailyGoalMinutes: input.dailyGoalMinutes,
      settingsSnapshot: {
        workDurationMinutes: ss.workDurationMinutes,
        shortBreakDurationMinutes: ss.shortBreakDurationMinutes,
        longBreakDurationMinutes: ss.longBreakDurationMinutes,
        longBreakInterval: ss.longBreakInterval,
        autoStartBreaks: ss.autoStartBreaks,
        autoStartPomodoros: ss.autoStartPomodoros,
      },
      deviceClass: input.deviceClass,
      tabBackgroundedCount: input.tabBackgroundedCount,
      completionLatencySeconds: input.completionLatencySeconds ?? undefined,
      source: input.source,
      updatedAtMs: input.updatedAtMs,
    },
  };
}

export function validateAndNormalizeEvent(
  input: MlEventInput
): { ok: true; value: MlEventDbDoc } | { ok: false; error: string } {
  if (!ID_REGEX.test(input.eventId)) {
    return { ok: false, error: "Invalid eventId format." };
  }
  if (!isValidIsoString(input.timestamp)) {
    return { ok: false, error: "Invalid timestamp format." };
  }
  if (!Number.isFinite(input.timestampMs) || input.timestampMs < 0) {
    return { ok: false, error: "Invalid timestampMs." };
  }
  if (!isFiniteInRange(input.utcOffsetMinutes, -840, 840)) {
    return { ok: false, error: "utcOffsetMinutes must be between -840 and 840." };
  }
  if (!LOCAL_DATE_REGEX.test(input.localDate)) {
    return { ok: false, error: "Invalid localDate format: must be YYYY-MM-DD." };
  }
  if (!isFiniteInRange(input.localHour, 0, 23)) {
    return { ok: false, error: "localHour must be between 0 and 23." };
  }
  if (!isFiniteInRange(input.localMinuteOfDay, 0, 1439)) {
    return { ok: false, error: "localMinuteOfDay must be between 0 and 1439." };
  }
  if (!isFiniteInRange(input.localDayOfWeek, 0, 6)) {
    return { ok: false, error: "localDayOfWeek must be between 0 and 6." };
  }
  if (input.ianaTimezone && input.ianaTimezone.length > 100) {
    return { ok: false, error: "ianaTimezone exceeds maximum length." };
  }
  if (input.attemptId && !ID_REGEX.test(input.attemptId)) {
    return { ok: false, error: "Invalid attemptId format." };
  }
  if (input.tagId && !TAG_ID_REGEX.test(input.tagId)) {
    return { ok: false, error: "Invalid tagId format." };
  }
  if (input.fromTagId && !TAG_ID_REGEX.test(input.fromTagId)) {
    return { ok: false, error: "Invalid fromTagId format." };
  }
  if (input.toTagId && !TAG_ID_REGEX.test(input.toTagId)) {
    return { ok: false, error: "Invalid toTagId format." };
  }
  if (input.cupId && !ID_REGEX.test(input.cupId)) {
    return { ok: false, error: "Invalid cupId format." };
  }
  if (input.cupDate && !LOCAL_DATE_REGEX.test(input.cupDate)) {
    return { ok: false, error: "Invalid cupDate format: must be YYYY-MM-DD." };
  }
  if (input.changedFields && input.changedFields.length > 50) {
    return { ok: false, error: "changedFields cannot exceed 50 items." };
  }
  if (input.changedFields && input.changedFields.some((f) => f.length > 64)) {
    return { ok: false, error: "changedFields entry exceeds maximum length." };
  }

  const optionalNonNegChecks: Array<[string, number | null | undefined, number]> = [
    ["plannedDurationSeconds", input.plannedDurationSeconds, 86400],
    ["elapsedActiveSeconds", input.elapsedActiveSeconds, 86400 * 7],
    ["remainingSeconds", input.remainingSeconds, 86400],
    ["pauseDurationSeconds", input.pauseDurationSeconds, 86400 * 7],
    ["cupIndexToday", input.cupIndexToday, 200],
    ["minutesSincePreviousCup", input.minutesSincePreviousCup, 60 * 24 * 365],
    ["minutesSinceLastWorkEnd", input.minutesSinceLastWorkEnd, 60 * 24 * 365],
    ["previousDailyGoalMinutes", input.previousDailyGoalMinutes, 1440],
    ["newDailyGoalMinutes", input.newDailyGoalMinutes, 1440],
  ];
  for (const [field, val, max] of optionalNonNegChecks) {
    if (val !== undefined && val !== null && !isFiniteInRange(val, 0, max)) {
      return { ok: false, error: `Invalid ${field} value.` };
    }
  }

  return {
    ok: true,
    value: {
      eventId: input.eventId,
      eventType: input.eventType,
      timestamp: input.timestamp,
      timestampMs: input.timestampMs,
      utcOffsetMinutes: input.utcOffsetMinutes,
      ianaTimezone: input.ianaTimezone || undefined,
      localDate: input.localDate,
      localHour: input.localHour,
      localMinuteOfDay: input.localMinuteOfDay,
      localDayOfWeek: input.localDayOfWeek,
      deviceClass: input.deviceClass,
      attemptId: input.attemptId || undefined,
      sessionType: input.sessionType ?? undefined,
      tagId: input.tagId || undefined,
      plannedDurationSeconds: input.plannedDurationSeconds ?? undefined,
      elapsedActiveSeconds: input.elapsedActiveSeconds ?? undefined,
      remainingSeconds: input.remainingSeconds ?? undefined,
      pauseDurationSeconds: input.pauseDurationSeconds ?? undefined,
      fromTagId: input.fromTagId || undefined,
      toTagId: input.toTagId || undefined,
      toSessionType: input.toSessionType ?? undefined,
      autoStarted: input.autoStarted ?? undefined,
      cupId: input.cupId || undefined,
      cupDate: input.cupDate || undefined,
      cupIndexToday: input.cupIndexToday ?? undefined,
      minutesSincePreviousCup: input.minutesSincePreviousCup ?? undefined,
      minutesSinceLastWorkEnd: input.minutesSinceLastWorkEnd ?? undefined,
      activeTimerStatus: input.activeTimerStatus ?? undefined,
      changedFields: input.changedFields ?? undefined,
      previousSettings: input.previousSettings ?? undefined,
      newSettings: input.newSettings ?? undefined,
      previousDailyGoalMinutes: input.previousDailyGoalMinutes ?? undefined,
      newDailyGoalMinutes: input.newDailyGoalMinutes ?? undefined,
      source: input.source ?? undefined,
    },
  };
}

export function formatAttemptForClient(doc: SessionAttemptDbDoc) {
  return {
    attemptId: doc.attemptId,
    sessionType: doc.sessionType,
    status: doc.status,
    wasStarted: doc.wasStarted,
    plannedDurationSeconds: doc.plannedDurationSeconds,
    actualActiveSeconds: doc.actualActiveSeconds,
    remainingSecondsAtEnd: doc.remainingSecondsAtEnd,
    completionRatio: doc.completionRatio,
    startedAt: doc.startedAt ?? null,
    endedAt: doc.endedAt ?? null,
    utcOffsetMinutes: doc.utcOffsetMinutes,
    ...(doc.ianaTimezone !== undefined ? { ianaTimezone: doc.ianaTimezone } : {}),
    localDate: doc.localDate,
    localHour: doc.localHour,
    localMinuteOfDay: doc.localMinuteOfDay,
    localDayOfWeek: doc.localDayOfWeek,
    cycleIndex: doc.cycleIndex,
    longBreakInterval: doc.longBreakInterval,
    autoStarted: doc.autoStarted,
    initialTagId: doc.initialTagId ?? null,
    tagId: doc.tagId ?? null,
    tagChangedMidRun: doc.tagChangedMidRun,
    pauseCount: doc.pauseCount,
    totalPausedSeconds: doc.totalPausedSeconds,
    pauseIntervals: doc.pauseIntervals,
    timeSincePreviousAttemptSeconds: doc.timeSincePreviousAttemptSeconds ?? null,
    previousAttemptType: doc.previousAttemptType ?? null,
    previousAttemptOutcome: doc.previousAttemptOutcome ?? null,
    workSessionsCompletedToday: doc.workSessionsCompletedToday,
    workActiveSecondsToday: doc.workActiveSecondsToday,
    skipsToday: doc.skipsToday,
    coffeeCupsTodayAtStart: doc.coffeeCupsTodayAtStart,
    minutesSinceLastCoffeeAtStart: doc.minutesSinceLastCoffeeAtStart ?? null,
    coffeeLoggedDuringRun: doc.coffeeLoggedDuringRun,
    dailyGoalMinutes: doc.dailyGoalMinutes,
    settingsSnapshot: doc.settingsSnapshot,
    deviceClass: doc.deviceClass,
    tabBackgroundedCount: doc.tabBackgroundedCount,
    completionLatencySeconds: doc.completionLatencySeconds ?? null,
    source: doc.source,
    updatedAtMs: doc.updatedAtMs,
  };
}

export function formatEventForClient(doc: MlEventDbDoc) {
  return {
    eventId: doc.eventId,
    eventType: doc.eventType,
    timestamp: doc.timestamp,
    timestampMs: doc.timestampMs,
    utcOffsetMinutes: doc.utcOffsetMinutes,
    ...(doc.ianaTimezone !== undefined ? { ianaTimezone: doc.ianaTimezone } : {}),
    localDate: doc.localDate,
    localHour: doc.localHour,
    localMinuteOfDay: doc.localMinuteOfDay,
    localDayOfWeek: doc.localDayOfWeek,
    deviceClass: doc.deviceClass,
    attemptId: doc.attemptId ?? null,
    sessionType: doc.sessionType ?? null,
    tagId: doc.tagId ?? null,
    plannedDurationSeconds: doc.plannedDurationSeconds ?? null,
    elapsedActiveSeconds: doc.elapsedActiveSeconds ?? null,
    remainingSeconds: doc.remainingSeconds ?? null,
    pauseDurationSeconds: doc.pauseDurationSeconds ?? null,
    fromTagId: doc.fromTagId ?? null,
    toTagId: doc.toTagId ?? null,
    toSessionType: doc.toSessionType ?? null,
    autoStarted: doc.autoStarted ?? null,
    cupId: doc.cupId ?? null,
    cupDate: doc.cupDate ?? null,
    cupIndexToday: doc.cupIndexToday ?? null,
    minutesSincePreviousCup: doc.minutesSincePreviousCup ?? null,
    minutesSinceLastWorkEnd: doc.minutesSinceLastWorkEnd ?? null,
    activeTimerStatus: doc.activeTimerStatus ?? null,
    changedFields: doc.changedFields ?? null,
    previousSettings: doc.previousSettings ?? null,
    newSettings: doc.newSettings ?? null,
    previousDailyGoalMinutes: doc.previousDailyGoalMinutes ?? null,
    newDailyGoalMinutes: doc.newDailyGoalMinutes ?? null,
    source: doc.source ?? null,
  };
}

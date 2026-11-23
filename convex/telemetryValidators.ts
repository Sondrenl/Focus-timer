import { v, Infer } from "convex/values";
import { MIN_DURATION_MINUTES } from "./defaultData";

export const ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;
export const TAG_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
export const LOCAL_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const sessionTypeValidator = v.union(
  v.literal("WORK"),
  v.literal("SHORT_BREAK"),
  v.literal("LONG_BREAK")
);

export const deviceClassValidator = v.union(
  v.literal("desktop"),
  v.literal("mobile")
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

const sessionAttemptCommonFields = {
  attemptId: v.string(),
  sessionType: sessionTypeValidator,
  status: attemptStatusValidator,
  wasStarted: v.boolean(),
  plannedDurationSeconds: v.number(),
  actualActiveSeconds: v.number(),
  remainingSecondsAtEnd: v.number(),
  completionRatio: v.number(),
  utcOffsetMinutes: v.number(),
  localDate: v.string(),
  localHour: v.number(),
  localMinuteOfDay: v.number(),
  localDayOfWeek: v.number(),
  cycleIndex: v.number(),
  longBreakInterval: v.number(),
  autoStarted: v.boolean(),
  tagChangedMidRun: v.boolean(),
  pauseCount: v.number(),
  totalPausedSeconds: v.number(),
  dailyGoalMinutes: v.number(),
  settingsSnapshot: settingsSnapshotValidator,
  deviceClass: deviceClassValidator,
  tabBackgroundedCount: v.number(),
  source: telemetrySourceValidator,
  updatedAtMs: v.number(),
};

export const sessionAttemptDbFields = {
  ...sessionAttemptCommonFields,
  startedAt: v.optional(v.string()),
  endedAt: v.optional(v.string()),
  ianaTimezone: v.optional(v.string()),
  initialTagId: v.optional(v.string()),
  tagId: v.optional(v.string()),
  pauseIntervals: v.array(pauseIntervalDbValidator),
  completionLatencySeconds: v.optional(v.number()),
};

export const sessionAttemptInputFields = {
  ...sessionAttemptCommonFields,
  startedAt: v.optional(v.union(v.string(), v.null())),
  endedAt: v.optional(v.union(v.string(), v.null())),
  ianaTimezone: v.optional(v.union(v.string(), v.null())),
  initialTagId: v.optional(v.union(v.string(), v.null())),
  tagId: v.optional(v.union(v.string(), v.null())),
  pauseIntervals: v.array(pauseIntervalInputValidator),
  completionLatencySeconds: v.optional(v.union(v.number(), v.null())),
};

export const sessionAttemptInputValidator = v.object(sessionAttemptInputFields);

export const sessionAttemptReturnValidator = v.object({
  ...sessionAttemptCommonFields,
  startedAt: v.union(v.string(), v.null()),
  endedAt: v.union(v.string(), v.null()),
  ianaTimezone: v.optional(v.string()),
  initialTagId: v.union(v.string(), v.null()),
  tagId: v.union(v.string(), v.null()),
  pauseIntervals: v.array(pauseIntervalDbValidator),
  completionLatencySeconds: v.union(v.number(), v.null()),
});

export type SessionAttemptInput = Infer<typeof sessionAttemptInputValidator>;
const sessionAttemptDbObjectValidator = v.object(sessionAttemptDbFields);
export type SessionAttemptDbDoc = Infer<typeof sessionAttemptDbObjectValidator>;

const inRange = (val: number, min: number, max: number) =>
  Number.isFinite(val) && val >= min && val <= max;

const isValidIso = (val: string) =>
  val.length > 0 && val.length <= 64 && !Number.isNaN(Date.parse(val));

export function validateAndNormalizeAttempt(
  input: SessionAttemptInput
): { ok: true; value: SessionAttemptDbDoc } | { ok: false; error: string } {
  if (!ID_REGEX.test(input.attemptId)) return { ok: false, error: "Invalid attemptId format." };
  if (!LOCAL_DATE_REGEX.test(input.localDate)) return { ok: false, error: "Invalid localDate format: must be YYYY-MM-DD." };

  const numericChecks: Array<[number, number, number, string]> = [
    [input.plannedDurationSeconds, 1, 86400, "plannedDurationSeconds must be between 1 and 86400."],
    [input.actualActiveSeconds, 0, 86400 * 7, "actualActiveSeconds must be between 0 and 604800."],
    [input.remainingSecondsAtEnd, 0, 86400, "remainingSecondsAtEnd must be between 0 and 86400."],
    [input.completionRatio, 0, 2, "completionRatio must be between 0 and 2."],
    [input.utcOffsetMinutes, -840, 840, "utcOffsetMinutes must be between -840 and 840."],
    [input.localHour, 0, 23, "localHour must be between 0 and 23."],
    [input.localMinuteOfDay, 0, 1439, "localMinuteOfDay must be between 0 and 1439."],
    [input.localDayOfWeek, 0, 6, "localDayOfWeek must be between 0 and 6."],
    [input.cycleIndex, 0, 1000, "cycleIndex must be between 0 and 1000."],
    [input.longBreakInterval, 1, 100, "longBreakInterval must be between 1 and 100."],
    [input.pauseCount, 0, 10000, "pauseCount must be between 0 and 10000."],
    [input.totalPausedSeconds, 0, 86400 * 7, "totalPausedSeconds must be between 0 and 604800."],
    [input.dailyGoalMinutes, 0, 1440, "Invalid dailyGoalMinutes."],
    [input.tabBackgroundedCount, 0, 100000, "Invalid tabBackgroundedCount."],
  ];
  for (const [val, min, max, error] of numericChecks) {
    if (!inRange(val, min, max)) return { ok: false, error };
  }

  if (input.pauseIntervals.length > 50) return { ok: false, error: "pauseIntervals cannot exceed 50 items." };

  const normalizedPauses: SessionAttemptDbDoc["pauseIntervals"] = [];
  for (const p of input.pauseIntervals) {
    if (!isValidIso(p.pausedAt)) return { ok: false, error: "Invalid pauseInterval pausedAt timestamp." };
    if (p.resumedAt && !isValidIso(p.resumedAt)) return { ok: false, error: "Invalid pauseInterval resumedAt timestamp." };
    if (p.durationSeconds != null && !inRange(p.durationSeconds, 0, 86400 * 7)) {
      return { ok: false, error: "Invalid pauseInterval durationSeconds." };
    }
    if (!inRange(p.elapsedActiveSecondsAtPause, 0, 86400 * 7)) {
      return { ok: false, error: "Invalid pauseInterval elapsedActiveSecondsAtPause." };
    }
    if (!inRange(p.remainingSecondsAtPause, 0, 86400)) {
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

  if (input.startedAt && !isValidIso(input.startedAt)) return { ok: false, error: "Invalid startedAt timestamp." };
  if (input.endedAt && !isValidIso(input.endedAt)) return { ok: false, error: "Invalid endedAt timestamp." };
  if (input.ianaTimezone && input.ianaTimezone.length > 100) return { ok: false, error: "ianaTimezone exceeds maximum length." };
  if (input.initialTagId && !TAG_ID_REGEX.test(input.initialTagId)) return { ok: false, error: "Invalid initialTagId format." };
  if (input.tagId && !TAG_ID_REGEX.test(input.tagId)) return { ok: false, error: "Invalid tagId format." };
  if (input.completionLatencySeconds != null && !inRange(input.completionLatencySeconds, 0, 86400 * 7)) {
    return { ok: false, error: "Invalid completionLatencySeconds." };
  }
  if (!Number.isFinite(input.updatedAtMs) || input.updatedAtMs < 0) return { ok: false, error: "Invalid updatedAtMs." };

  const ss = input.settingsSnapshot;
  if (
    !inRange(ss.workDurationMinutes, MIN_DURATION_MINUTES, 360) ||
    !inRange(ss.shortBreakDurationMinutes, MIN_DURATION_MINUTES, 360) ||
    !inRange(ss.longBreakDurationMinutes, MIN_DURATION_MINUTES, 360) ||
    !inRange(ss.longBreakInterval, 1, 100)
  ) {
    return { ok: false, error: "Invalid settingsSnapshot values." };
  }

  return {
    ok: true,
    value: {
      ...input,
      startedAt: input.startedAt || undefined,
      endedAt: input.endedAt || undefined,
      ianaTimezone: input.ianaTimezone || undefined,
      initialTagId: input.initialTagId || undefined,
      tagId: input.tagId || undefined,
      pauseIntervals: normalizedPauses,
      completionLatencySeconds: input.completionLatencySeconds ?? undefined,
      settingsSnapshot: { ...ss },
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
    dailyGoalMinutes: doc.dailyGoalMinutes,
    settingsSnapshot: doc.settingsSnapshot,
    deviceClass: doc.deviceClass,
    tabBackgroundedCount: doc.tabBackgroundedCount,
    completionLatencySeconds: doc.completionLatencySeconds ?? null,
    source: doc.source,
    updatedAtMs: doc.updatedAtMs,
  };
}

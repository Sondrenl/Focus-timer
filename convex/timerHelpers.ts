import { MutationCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { DEFAULT_SETTINGS } from "./authHelper";
import { TAG_ID_REGEX } from "./telemetryValidators";

export { TAG_ID_REGEX };

export type TimerSessionType = "WORK" | "SHORT_BREAK" | "LONG_BREAK";

const IDENTIFIER_REGEX = /^[a-zA-Z0-9_-]+$/;
export const MAX_FUTURE_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

export async function cancelScheduledJob(
  ctx: MutationCtx,
  jobId: Id<"_scheduled_functions"> | undefined
): Promise<void> {
  if (jobId) {
    try {
      await ctx.scheduler.cancel(jobId);
    } catch {
      // Ignore if already completed or expired
    }
  }
}

export function assertValidDurationSeconds(value: number, fieldName = "durationSeconds"): void {
  if (!Number.isFinite(value) || value < 1 || value > 86400) {
    throw new Error(`${fieldName} must be between 1 and 86400.`);
  }
  if (!Number.isInteger(value)) {
    throw new Error(`${fieldName} must be an integer.`);
  }
}

export function assertValidRemainingSeconds(value: number, fieldName = "remainingSeconds"): void {
  if (!Number.isFinite(value) || value < 0 || value > 86400) {
    throw new Error(`${fieldName} must be between 0 and 86400.`);
  }
  if (!Number.isInteger(value)) {
    throw new Error(`${fieldName} must be an integer.`);
  }
}

export function assertValidCycle(value: number, fieldName = "currentCycle"): void {
  if (!Number.isFinite(value) || value < 1 || value > 100) {
    throw new Error(`${fieldName} must be between 1 and 100.`);
  }
  if (!Number.isInteger(value)) {
    throw new Error(`${fieldName} must be an integer.`);
  }
}

export function assertValidTimerRunId(
  value: string | null | undefined,
  fieldName = "timerRunId",
  required = false
): void {
  if (!value) {
    if (required) {
      throw new Error(`Invalid ${fieldName} format.`);
    }
    return;
  }
  if (value.length > 128 || !IDENTIFIER_REGEX.test(value)) {
    throw new Error(`Invalid ${fieldName} format.`);
  }
}

export function assertValidTagId(
  value: string | null | undefined,
  errorMessage = "Invalid tagId format.",
  required = false
): void {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw new Error(errorMessage);
    }
    return;
  }
  if (!TAG_ID_REGEX.test(value)) {
    throw new Error(errorMessage);
  }
}

export function generateScheduleNonce(nowMs: number): string {
  return `sched-${nowMs}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function recordCompletedSessionIfNotDuplicate(
  ctx: MutationCtx,
  params: {
    userId: Id<"users">;
    tagId: string | undefined;
    sessionType: TimerSessionType;
    durationSeconds: number;
    completedAtMs: number;
    timerRunId?: string | null;
  }
): Promise<{
  id: Id<"sessions">;
  tagId: string | null;
  sessionType: TimerSessionType;
  durationSeconds: number;
  completedAt: string;
  timerRunId: string | null;
  wasDuplicate: boolean;
}> {
  const cleanTimerRunId = params.timerRunId || undefined;
  const completedAtIso = new Date(params.completedAtMs).toISOString();

  // 1. Primary exact deduplication by (userId, timerRunId) — immune to clock skew and safe for rapid short sessions
  if (cleanTimerRunId) {
    const exactMatch = await ctx.db
      .query("sessions")
      .withIndex("by_user_run", (q) =>
        q.eq("userId", params.userId).eq("timerRunId", cleanTimerRunId)
      )
      .first();

    if (exactMatch) {
      return {
        id: exactMatch._id,
        tagId: exactMatch.tagId ?? null,
        sessionType: exactMatch.sessionType,
        durationSeconds: exactMatch.durationSeconds,
        completedAt: exactMatch.completedAt,
        timerRunId: exactMatch.timerRunId ?? null,
        wasDuplicate: true,
      };
    }
  }

  // 2. Fallback window deduplication ONLY when matching against legacy run-less records
  //    (or when caller didn't supply a timerRunId). Two distinct timerRunIds never collide.
  const recent = await ctx.db
    .query("sessions")
    .withIndex("by_user_completed", (q) =>
      q
        .eq("userId", params.userId)
        .gte("completedAt", new Date(params.completedAtMs - 45000).toISOString())
        .lte("completedAt", new Date(params.completedAtMs + 45000).toISOString())
    )
    .take(50);

  const duplicate = recent.find((s) => {
    if (s.sessionType !== params.sessionType) return false;
    if (cleanTimerRunId && s.timerRunId && s.timerRunId !== cleanTimerRunId) {
      return false;
    }
    return Math.abs(Date.parse(s.completedAt) - params.completedAtMs) <= 45000;
  });

  if (duplicate) {
    // Backfill timerRunId onto an existing run-less duplicate so subsequent retries hit the exact index
    if (cleanTimerRunId && !duplicate.timerRunId) {
      await ctx.db.patch(duplicate._id, { timerRunId: cleanTimerRunId });
    }
    return {
      id: duplicate._id,
      tagId: duplicate.tagId ?? null,
      sessionType: duplicate.sessionType,
      durationSeconds: duplicate.durationSeconds,
      completedAt: duplicate.completedAt,
      timerRunId: cleanTimerRunId ?? duplicate.timerRunId ?? null,
      wasDuplicate: true,
    };
  }

  const sessionId = await ctx.db.insert("sessions", {
    userId: params.userId,
    tagId: params.tagId,
    sessionType: params.sessionType,
    durationSeconds: params.durationSeconds,
    completedAt: completedAtIso,
    timerRunId: cleanTimerRunId,
  });

  return {
    id: sessionId,
    tagId: params.tagId ?? null,
    sessionType: params.sessionType,
    durationSeconds: params.durationSeconds,
    completedAt: completedAtIso,
    timerRunId: cleanTimerRunId ?? null,
    wasDuplicate: false,
  };
}

export async function reconcileCompletedSessionAttempt(
  ctx: MutationCtx,
  params: {
    userId: Id<"users">;
    attemptId: string | null | undefined;
    totalSeconds: number;
    targetEndTime: number | undefined;
    completedAtIso: string;
    nowMs: number;
    source: "client" | "server_scheduled";
  }
): Promise<void> {
  if (!params.attemptId) return;
  const attemptId = params.attemptId;
  const existingAttempt = await ctx.db
    .query("session_attempts")
    .withIndex("by_user_attempt", (q) =>
      q.eq("userId", params.userId).eq("attemptId", attemptId)
    )
    .first();

  if (existingAttempt && existingAttempt.status === "in_progress") {
    const completionLatencySeconds = params.targetEndTime
      ? Math.max(0, Math.round((params.nowMs - params.targetEndTime) / 1000))
      : 0;
    const actualActiveSeconds =
      existingAttempt.plannedDurationSeconds || params.totalSeconds;

    await ctx.db.patch(existingAttempt._id, {
      status: "completed",
      endedAt: params.completedAtIso,
      actualActiveSeconds,
      remainingSecondsAtEnd: 0,
      completionRatio: 1,
      completionLatencySeconds,
      source: params.source,
      updatedAtMs: params.nowMs,
    });
  }
}

export function computeServerNextInterval(
  completedType: TimerSessionType,
  currentCycle: number,
  userSettings?: typeof DEFAULT_SETTINGS | null
): {
  nextType: TimerSessionType;
  nextCycle: number;
  nextDurationSec: number;
  shouldAutoStart: boolean;
} {
  const settings = userSettings ?? DEFAULT_SETTINGS;
  const interval = Math.max(1, settings.longBreakInterval || 4);
  const curCycle = Math.max(1, currentCycle || 1);

  let nextType: TimerSessionType;
  let nextCycle: number;
  if (completedType === "WORK") {
    if (curCycle >= interval) {
      nextType = "LONG_BREAK";
      nextCycle = curCycle;
    } else {
      nextType = "SHORT_BREAK";
      nextCycle = curCycle;
    }
  } else if (completedType === "LONG_BREAK") {
    nextType = "WORK";
    nextCycle = 1;
  } else {
    nextType = "WORK";
    nextCycle = curCycle + 1;
  }

  const nextMinutes =
    nextType === "WORK"
      ? settings.workDurationMinutes
      : nextType === "SHORT_BREAK"
      ? settings.shortBreakDurationMinutes
      : settings.longBreakDurationMinutes;
  const nextDurationSec = Math.max(1, Math.round(nextMinutes * 60));
  const shouldAutoStart =
    nextType === "WORK"
      ? Boolean(settings.autoStartPomodoros)
      : Boolean(settings.autoStartBreaks);

  return { nextType, nextCycle, nextDurationSec, shouldAutoStart };
}

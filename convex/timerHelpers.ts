import { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { DEFAULT_SETTINGS, DEFAULT_TAGS } from "./authHelper";
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

function assertIntegerInRange(
  value: number,
  min: number,
  max: number,
  fieldName: string
): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${fieldName} must be between ${min} and ${max}.`);
  }
  if (!Number.isInteger(value)) {
    throw new Error(`${fieldName} must be an integer.`);
  }
}

export function assertValidDurationSeconds(value: number, fieldName = "durationSeconds"): void {
  assertIntegerInRange(value, 1, 86400, fieldName);
}

export function assertValidRemainingSeconds(value: number, fieldName = "remainingSeconds"): void {
  assertIntegerInRange(value, 0, 86400, fieldName);
}

export function assertValidCycle(value: number, fieldName = "currentCycle"): void {
  assertIntegerInRange(value, 1, 100, fieldName);
}

export function assertValidTimerRunId(
  value: string | null | undefined,
  fieldName = "timerRunId",
  required = false
): void {
  if (!value) {
    if (required) throw new Error(`Invalid ${fieldName} format.`);
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
  if (!value) {
    if (required) throw new Error(errorMessage);
    return;
  }
  if (!TAG_ID_REGEX.test(value)) {
    throw new Error(errorMessage);
  }
}

export function resolveExistingUserTagId(
  user: { tags?: Array<{ id: string }> } | null | undefined,
  rawTagId: string | null | undefined
): string | undefined {
  assertValidTagId(rawTagId);
  if (!rawTagId) return undefined;
  const userTags = user?.tags ?? DEFAULT_TAGS;
  return userTags.some((t) => t.id === rawTagId) ? rawTagId : undefined;
}

export function generateScheduleNonce(nowMs: number): string {
  return `sched-${nowMs}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function scheduleCompletionJob(
  ctx: MutationCtx,
  userId: Id<"users">,
  timerRunId: string,
  delaySeconds: number,
  nowMs: number
): Promise<{
  targetEndTime: number;
  scheduleNonce: string;
  scheduledCompletionId: Id<"_scheduled_functions">;
}> {
  const targetEndTime = nowMs + delaySeconds * 1000;
  const scheduleNonce = generateScheduleNonce(nowMs);
  const scheduledCompletionId = await ctx.scheduler.runAfter(
    delaySeconds * 1000,
    internal.timer.onTimerCompleted,
    { userId, timerRunId, scheduleNonce }
  );
  return { targetEndTime, scheduleNonce, scheduledCompletionId };
}

export function buildIdleTimerPayload(params: {
  sessionType: TimerSessionType;
  durationSeconds: number;
  currentCycle: number;
  tagId?: string;
  lastCompletedTimerRunId?: string;
  updatedAtMs: number;
}) {
  return {
    sessionType: params.sessionType,
    status: "IDLE" as const,
    remainingSeconds: params.durationSeconds,
    totalSeconds: params.durationSeconds,
    targetEndTime: undefined,
    currentCycle: params.currentCycle,
    ...(params.tagId !== undefined ? { tagId: params.tagId } : {}),
    timerRunId: undefined,
    lastCompletedTimerRunId: params.lastCompletedTimerRunId,
    scheduleNonce: undefined,
    serverAutoStartStreak: 0,
    scheduledCompletionId: undefined,
    updatedAtMs: params.updatedAtMs,
  };
}

export async function dispatchCompletionPushIfSubscribed(
  ctx: MutationCtx,
  params: {
    userId: Id<"users">;
    sessionType: TimerSessionType;
    timerRunId: string;
    completedAtMs: number;
    targetEndTime: number | undefined;
    nowMs: number;
    maxWindowMs: number;
  }
): Promise<void> {
  if (params.targetEndTime && params.nowMs - params.targetEndTime > params.maxWindowMs) {
    return;
  }
  const hasPushSub = Boolean(
    await ctx.db
      .query("push_subscriptions")
      .withIndex("by_user_device", (q) => q.eq("userId", params.userId))
      .first()
  );
  if (hasPushSub) {
    await ctx.scheduler.runAfter(0, internal.pushActions.sendTimerCompletionPush, {
      userId: params.userId,
      sessionType: params.sessionType,
      timerRunId: params.timerRunId,
      completedAtMs: Math.round(params.completedAtMs),
    });
  }
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
) {
  const cleanTimerRunId = params.timerRunId || undefined;
  const completedAtIso = new Date(params.completedAtMs).toISOString();
  const formatSessionResult = (
    id: Id<"sessions">,
    row: {
      tagId?: string | null;
      sessionType: TimerSessionType;
      durationSeconds: number;
      completedAt: string;
      timerRunId?: string | null;
    },
    wasDuplicate: boolean
  ) => ({
    id,
    tagId: row.tagId ?? null,
    sessionType: row.sessionType,
    durationSeconds: row.durationSeconds,
    completedAt: row.completedAt,
    timerRunId: row.timerRunId ?? null,
    wasDuplicate,
  });

  if (cleanTimerRunId) {
    const exactMatch = await ctx.db
      .query("sessions")
      .withIndex("by_user_run", (q) =>
        q.eq("userId", params.userId).eq("timerRunId", cleanTimerRunId)
      )
      .first();

    if (exactMatch) {
      return formatSessionResult(exactMatch._id, exactMatch, true);
    }
  }

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
    if (cleanTimerRunId && s.timerRunId && s.timerRunId !== cleanTimerRunId) return false;
    return Math.abs(Date.parse(s.completedAt) - params.completedAtMs) <= 45000;
  });

  if (duplicate) {
    if (cleanTimerRunId && !duplicate.timerRunId) {
      await ctx.db.patch(duplicate._id, { timerRunId: cleanTimerRunId });
    }
    return formatSessionResult(
      duplicate._id,
      { ...duplicate, timerRunId: cleanTimerRunId ?? duplicate.timerRunId },
      true
    );
  }

  const sessionId = await ctx.db.insert("sessions", {
    userId: params.userId,
    tagId: params.tagId,
    sessionType: params.sessionType,
    durationSeconds: params.durationSeconds,
    completedAt: completedAtIso,
    timerRunId: cleanTimerRunId,
  });

  return formatSessionResult(
    sessionId,
    {
      tagId: params.tagId,
      sessionType: params.sessionType,
      durationSeconds: params.durationSeconds,
      completedAt: completedAtIso,
      timerRunId: cleanTimerRunId,
    },
    false
  );
}

export function computeServerNextInterval(
  completedType: TimerSessionType,
  currentCycle: number,
  userSettings?: typeof DEFAULT_SETTINGS | null
) {
  const settings = userSettings ?? DEFAULT_SETTINGS;
  const interval = Math.max(1, settings.longBreakInterval || 4);
  const curCycle = Math.max(1, currentCycle || 1);

  const nextType: TimerSessionType =
    completedType === "WORK"
      ? curCycle >= interval
        ? "LONG_BREAK"
        : "SHORT_BREAK"
      : "WORK";
  const nextCycle =
    completedType === "WORK"
      ? curCycle
      : completedType === "LONG_BREAK"
      ? 1
      : curCycle + 1;

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

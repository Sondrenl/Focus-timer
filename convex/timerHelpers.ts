import { MutationCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { DEFAULT_SETTINGS } from "./authHelper";
import { TAG_ID_REGEX } from "./telemetryValidators";

export { TAG_ID_REGEX };

export type TimerSessionType = "WORK" | "SHORT_BREAK" | "LONG_BREAK";

export interface PeerPresenceRecord {
  desktopActive: boolean;
  desktopVisible: boolean;
  mobileActive: boolean;
  mobileVisible: boolean;
  lastSeenMs: number;
  desktopLastSeenMs?: number;
  mobileLastSeenMs?: number;
}

const IDENTIFIER_REGEX = /^[a-zA-Z0-9_-]+$/;
const PRESENCE_TTL_MS = 90_000;
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
}

export function assertValidRemainingSeconds(value: number, fieldName = "remainingSeconds"): void {
  if (!Number.isFinite(value) || value < 0 || value > 86400) {
    throw new Error(`${fieldName} must be between 0 and 86400.`);
  }
}

export function assertValidCycle(value: number, fieldName = "currentCycle"): void {
  if (!Number.isFinite(value) || value < 1 || value > 100) {
    throw new Error(`${fieldName} must be between 1 and 100.`);
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

export async function recordCompletedSessionIfNotDuplicate(
  ctx: MutationCtx,
  params: {
    userId: Id<"users">;
    tagId: string | undefined;
    sessionType: TimerSessionType;
    durationSeconds: number;
    completedAtMs: number;
  }
): Promise<{
  id: Id<"sessions">;
  tagId: string | null;
  sessionType: TimerSessionType;
  durationSeconds: number;
  completedAt: string;
  wasDuplicate: boolean;
}> {
  const completedAtIso = new Date(params.completedAtMs).toISOString();
  const recent = await ctx.db
    .query("sessions")
    .withIndex("by_user_completed", (q) =>
      q
        .eq("userId", params.userId)
        .gte("completedAt", new Date(params.completedAtMs - 45000).toISOString())
        .lte("completedAt", new Date(params.completedAtMs + 45000).toISOString())
    )
    .take(50);

  const duplicate = recent.find(
    (s) =>
      s.sessionType === params.sessionType &&
      Math.abs(Date.parse(s.completedAt) - params.completedAtMs) <= 45000
  );

  if (duplicate) {
    return {
      id: duplicate._id,
      tagId: duplicate.tagId ?? null,
      sessionType: duplicate.sessionType,
      durationSeconds: duplicate.durationSeconds,
      completedAt: duplicate.completedAt,
      wasDuplicate: true,
    };
  }

  const sessionId = await ctx.db.insert("sessions", {
    userId: params.userId,
    tagId: params.tagId,
    sessionType: params.sessionType,
    durationSeconds: params.durationSeconds,
    completedAt: completedAtIso,
  });

  return {
    id: sessionId,
    tagId: params.tagId ?? null,
    sessionType: params.sessionType,
    durationSeconds: params.durationSeconds,
    completedAt: completedAtIso,
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

  return { nextType, nextCycle, nextDurationSec };
}

export function computeUpdatedPeerPresence(
  existingPresence: PeerPresenceRecord | undefined,
  args: { isMobile: boolean; isVisible: boolean },
  now: number
): { shouldPatch: boolean; presence: PeerPresenceRecord } {
  const currentPresence: PeerPresenceRecord = existingPresence ?? {
    desktopActive: false,
    desktopVisible: false,
    mobileActive: false,
    mobileVisible: false,
    lastSeenMs: 0,
    desktopLastSeenMs: 0,
    mobileLastSeenMs: 0,
  };

  const prevDesktopSeen = currentPresence.desktopLastSeenMs ?? currentPresence.lastSeenMs ?? 0;
  const prevMobileSeen = currentPresence.mobileLastSeenMs ?? currentPresence.lastSeenMs ?? 0;

  const peerDesktopFresh = now - prevDesktopSeen < PRESENCE_TTL_MS;
  const peerMobileFresh = now - prevMobileSeen < PRESENCE_TTL_MS;

  const newDesktopActive = args.isMobile
    ? peerDesktopFresh && currentPresence.desktopActive
    : true;
  const newDesktopVisible = args.isMobile
    ? peerDesktopFresh && currentPresence.desktopVisible
    : args.isVisible;
  const newMobileActive = args.isMobile
    ? true
    : peerMobileFresh && currentPresence.mobileActive;
  const newMobileVisible = args.isMobile
    ? args.isVisible
    : peerMobileFresh && currentPresence.mobileVisible;

  const newDesktopLastSeenMs = args.isMobile ? prevDesktopSeen : now;
  const newMobileLastSeenMs = args.isMobile ? now : prevMobileSeen;

  const flagsChanged =
    newDesktopActive !== currentPresence.desktopActive ||
    newDesktopVisible !== currentPresence.desktopVisible ||
    newMobileActive !== currentPresence.mobileActive ||
    newMobileVisible !== currentPresence.mobileVisible;

  const thisDeviceLastSeen = args.isMobile ? prevMobileSeen : prevDesktopSeen;
  if (!flagsChanged && now - thisDeviceLastSeen < 60_000) {
    return { shouldPatch: false, presence: currentPresence };
  }

  return {
    shouldPatch: true,
    presence: {
      desktopActive: newDesktopActive,
      desktopVisible: newDesktopVisible,
      mobileActive: newMobileActive,
      mobileVisible: newMobileVisible,
      lastSeenMs: now,
      desktopLastSeenMs: newDesktopLastSeenMs,
      mobileLastSeenMs: newMobileLastSeenMs,
    },
  };
}

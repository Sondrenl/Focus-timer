import { v } from "convex/values";
import { query, mutation, internalMutation, QueryCtx, MutationCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requireUser, getAuthenticatedUser, DEFAULT_SETTINGS } from "./authHelper";
import {
  assertValidCycle,
  assertValidDurationSeconds,
  assertValidRemainingSeconds,
  assertValidTimerRunId,
  buildIdleTimerPayload,
  cancelScheduledJob,
  computeServerNextInterval,
  dispatchCompletionPushIfSubscribed,
  recordCompletedSessionIfNotDuplicate,
  resolveExistingUserTagId,
  scheduleCompletionJob,
} from "./timerHelpers";

const MAX_UNATTENDED_SERVER_AUTO_STARTS = 1;
const STALE_CLIENT_ACTION_TOLERANCE_MS = 5_000;
const sessionTypeValidator = v.union(
  v.literal("WORK"),
  v.literal("SHORT_BREAK"),
  v.literal("LONG_BREAK")
);

async function getUserActiveTimer(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  return ctx.db
    .query("active_timers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
}

export const getActive = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return null;

    const timer = await getUserActiveTimer(ctx, user._id);
    if (!timer) return null;

    return {
      sessionType: timer.sessionType,
      status: timer.status,
      remainingSeconds: timer.remainingSeconds,
      totalSeconds: timer.totalSeconds,
      targetEndTime: timer.targetEndTime ?? null,
      currentCycle: timer.currentCycle,
      activeTagId: timer.tagId ?? null,
      timerRunId: timer.timerRunId ?? null,
      lastCompletedTimerRunId: timer.lastCompletedTimerRunId ?? null,
      serverAutoStartStreak: timer.serverAutoStartStreak ?? 0,
      updatedAtMs: timer.updatedAtMs,
    };
  },
});

export const acknowledgeActive = mutation({
  args: { timerRunId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    assertValidTimerRunId(args.timerRunId, "timerRunId", true);
    const now = Date.now();
    const existing = await getUserActiveTimer(ctx, user._id);
    if (!existing) return { acknowledged: false, serverNowMs: now };

    const shouldResetStreak =
      existing.status === "RUNNING" &&
      existing.timerRunId === args.timerRunId &&
      (existing.serverAutoStartStreak ?? 0) > 0;

    if (shouldResetStreak) {
      await ctx.db.patch(existing._id, { serverAutoStartStreak: 0 });
    }

    return {
      acknowledged: shouldResetStreak,
      updatedAtMs: existing.updatedAtMs,
      serverNowMs: now,
    };
  },
});

export const start = mutation({
  args: {
    sessionType: sessionTypeValidator,
    durationSeconds: v.number(),
    remainingSeconds: v.optional(v.number()),
    totalSeconds: v.optional(v.number()),
    currentCycle: v.number(),
    tagId: v.optional(v.union(v.string(), v.null())),
    timerRunId: v.string(),
    clientActionAtMs: v.optional(v.number()),
    clientTargetEndTimeMs: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<any> => {
    const user = await requireUser(ctx, true);
    assertValidDurationSeconds(args.durationSeconds, "durationSeconds");
    if (args.remainingSeconds !== undefined) {
      assertValidRemainingSeconds(args.remainingSeconds, "remainingSeconds");
    }
    if (args.totalSeconds !== undefined) {
      assertValidDurationSeconds(args.totalSeconds, "totalSeconds");
    }
    assertValidCycle(args.currentCycle, "currentCycle");
    assertValidTimerRunId(args.timerRunId, "timerRunId", true);
    if (args.clientActionAtMs !== undefined && !Number.isFinite(args.clientActionAtMs)) {
      throw new Error("Invalid clientActionAtMs.");
    }
    if (args.clientTargetEndTimeMs !== undefined && !Number.isFinite(args.clientTargetEndTimeMs)) {
      throw new Error("Invalid clientTargetEndTimeMs.");
    }
    const sanitizedTagId = resolveExistingUserTagId(user, args.tagId);
    const now = Date.now();
    const existing = await getUserActiveTimer(ctx, user._id);

    if (
      args.clientActionAtMs !== undefined &&
      existing &&
      existing.updatedAtMs > args.clientActionAtMs + STALE_CLIENT_ACTION_TOLERANCE_MS
    ) {
      return { ...existing, applied: false, serverNowMs: now };
    }

    if (
      args.clientTargetEndTimeMs !== undefined &&
      args.clientTargetEndTimeMs <= now - STALE_CLIENT_ACTION_TOLERANCE_MS
    ) {
      return existing
        ? { ...existing, applied: false, rejectedReason: "already_elapsed" as const, serverNowMs: now }
        : null;
    }

    const baseTotal = args.totalSeconds ?? args.durationSeconds;
    const remaining = Math.max(1, Math.min(baseTotal, args.remainingSeconds ?? args.durationSeconds));
    const total = Math.max(remaining, baseTotal);

    await cancelScheduledJob(ctx, existing?.scheduledCompletionId);
    const { targetEndTime, scheduleNonce, scheduledCompletionId } = await scheduleCompletionJob(
      ctx,
      user._id,
      args.timerRunId,
      remaining,
      now
    );

    const timerPayload = {
      userId: user._id,
      sessionType: args.sessionType,
      status: "RUNNING" as const,
      remainingSeconds: remaining,
      totalSeconds: total,
      targetEndTime,
      currentCycle: args.currentCycle,
      tagId: sanitizedTagId,
      timerRunId: args.timerRunId,
      lastCompletedTimerRunId: undefined,
      scheduleNonce,
      serverAutoStartStreak: 0,
      updatedAtMs: now,
      scheduledCompletionId,
    };

    if (existing) {
      await ctx.db.patch(existing._id, timerPayload);
    } else {
      await ctx.db.insert("active_timers", timerPayload);
    }

    return { ...timerPayload, applied: true, serverNowMs: now };
  },
});

export const pause = mutation({
  args: {
    remainingSeconds: v.number(),
    tagId: v.optional(v.union(v.string(), v.null())),
    expectedTimerRunId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<any> => {
    const user = await requireUser(ctx);
    assertValidRemainingSeconds(args.remainingSeconds, "remainingSeconds");
    const resolvedTagId =
      args.tagId !== undefined ? resolveExistingUserTagId(user, args.tagId) : undefined;
    assertValidTimerRunId(args.expectedTimerRunId, "expectedTimerRunId");

    const existing = await getUserActiveTimer(ctx, user._id);
    if (!existing) return null;

    const now = Date.now();
    if (
      (existing.status !== "RUNNING" && existing.status !== "PAUSED") ||
      (args.expectedTimerRunId && existing.timerRunId && existing.timerRunId !== args.expectedTimerRunId)
    ) {
      return { ...existing, applied: false, serverNowMs: now };
    }

    const clampedRemaining = Math.max(
      0,
      Math.min(existing.totalSeconds, Math.round(args.remainingSeconds))
    );
    const nextTagId = args.tagId !== undefined ? resolvedTagId : existing.tagId;
    if (
      existing.status === "PAUSED" &&
      existing.remainingSeconds === clampedRemaining &&
      (existing.tagId ?? undefined) === nextTagId
    ) {
      return { ...existing, applied: true, serverNowMs: now };
    }

    await cancelScheduledJob(ctx, existing.scheduledCompletionId);

    const updates = {
      status: "PAUSED" as const,
      remainingSeconds: clampedRemaining,
      tagId: nextTagId,
      targetEndTime: undefined,
      scheduledCompletionId: undefined,
      scheduleNonce: undefined,
      serverAutoStartStreak: 0,
      updatedAtMs: now,
    };

    await ctx.db.patch(existing._id, updates);
    return { ...existing, ...updates, applied: true, serverNowMs: now };
  },
});

export const updateTag = mutation({
  args: {
    tagId: v.optional(v.union(v.string(), v.null())),
    expectedTimerRunId: v.optional(v.string()),
    expectedStatus: v.optional(
      v.union(v.literal("IDLE"), v.literal("RUNNING"), v.literal("PAUSED"))
    ),
  },
  handler: async (ctx, args): Promise<any> => {
    const user = await requireUser(ctx, true);
    const sanitizedTagId = resolveExistingUserTagId(user, args.tagId);
    assertValidTimerRunId(args.expectedTimerRunId, "expectedTimerRunId");

    const existing = await getUserActiveTimer(ctx, user._id);
    if (!existing) return null;

    const now = Date.now();
    if (
      (args.expectedStatus && existing.status !== args.expectedStatus) ||
      (args.expectedTimerRunId && existing.timerRunId !== args.expectedTimerRunId)
    ) {
      return { ...existing, applied: false, serverNowMs: now };
    }

    if ((existing.tagId ?? undefined) === sanitizedTagId) {
      return { ...existing, applied: true, serverNowMs: now };
    }

    const updates = { tagId: sanitizedTagId, updatedAtMs: now };
    await ctx.db.patch(existing._id, updates);
    return { ...existing, ...updates, applied: true, serverNowMs: now };
  },
});

export const reset = mutation({
  args: {
    sessionType: sessionTypeValidator,
    durationSeconds: v.number(),
    currentCycle: v.number(),
    tagId: v.optional(v.union(v.string(), v.null())),
    onlyIfNotRunning: v.optional(v.boolean()),
    onlyIfIdle: v.optional(v.boolean()),
    expectedTimerRunId: v.optional(v.string()),
    expectedUpdatedAtMs: v.optional(v.number()),
    clientActionAtMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, true);
    assertValidDurationSeconds(args.durationSeconds, "durationSeconds");
    assertValidCycle(args.currentCycle, "currentCycle");
    const sanitizedTagId = resolveExistingUserTagId(user, args.tagId);
    assertValidTimerRunId(args.expectedTimerRunId, "expectedTimerRunId");
    if (args.expectedUpdatedAtMs !== undefined && !Number.isFinite(args.expectedUpdatedAtMs)) {
      throw new Error("Invalid expectedUpdatedAtMs.");
    }
    if (args.clientActionAtMs !== undefined && !Number.isFinite(args.clientActionAtMs)) {
      throw new Error("Invalid clientActionAtMs.");
    }
    const now = Date.now();
    const existing = await getUserActiveTimer(ctx, user._id);

    if (args.expectedTimerRunId !== undefined && existing?.timerRunId !== args.expectedTimerRunId) {
      return existing ? { ...existing, applied: false, serverNowMs: now } : null;
    }
    if (
      existing &&
      ((args.onlyIfIdle && (existing.status === "RUNNING" || existing.status === "PAUSED")) ||
        (args.onlyIfNotRunning && existing.status === "RUNNING") ||
        (args.expectedUpdatedAtMs !== undefined && existing.updatedAtMs > args.expectedUpdatedAtMs) ||
        (args.clientActionAtMs !== undefined &&
          existing.updatedAtMs > args.clientActionAtMs + STALE_CLIENT_ACTION_TOLERANCE_MS))
    ) {
      return { ...existing, applied: false, serverNowMs: now };
    }

    if (
      existing &&
      existing.status === "IDLE" &&
      existing.sessionType === args.sessionType &&
      existing.remainingSeconds === args.durationSeconds &&
      existing.totalSeconds === args.durationSeconds &&
      existing.currentCycle === args.currentCycle &&
      (existing.tagId ?? undefined) === sanitizedTagId &&
      existing.lastCompletedTimerRunId === undefined
    ) {
      return { ...existing, applied: true, serverNowMs: now };
    }

    await cancelScheduledJob(ctx, existing?.scheduledCompletionId);

    const resetPayload = {
      ...buildIdleTimerPayload({
        sessionType: args.sessionType,
        durationSeconds: args.durationSeconds,
        currentCycle: args.currentCycle,
        updatedAtMs: now,
      }),
      tagId: sanitizedTagId,
    };

    if (existing) {
      await ctx.db.patch(existing._id, resetPayload);
    } else {
      await ctx.db.insert("active_timers", { userId: user._id, ...resetPayload });
    }

    return { ...resetPayload, applied: true, serverNowMs: now };
  },
});

export const complete = mutation({
  args: {
    completedTimerRunId: v.optional(v.union(v.string(), v.null())),
    nextSessionType: sessionTypeValidator,
    nextDurationSeconds: v.number(),
    nextCurrentCycle: v.number(),
    autoStartNext: v.optional(v.boolean()),
    nextTimerRunId: v.optional(v.union(v.string(), v.null())),
    tagId: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args): Promise<any> => {
    const user = await requireUser(ctx, true);
    assertValidDurationSeconds(args.nextDurationSeconds, "nextDurationSeconds");
    assertValidCycle(args.nextCurrentCycle, "nextCurrentCycle");
    assertValidTimerRunId(args.completedTimerRunId, "completedTimerRunId");
    assertValidTimerRunId(args.nextTimerRunId, "nextTimerRunId");
    const resolvedTagId =
      args.tagId !== undefined ? resolveExistingUserTagId(user, args.tagId) : undefined;

    const existing = await getUserActiveTimer(ctx, user._id);
    if (!existing) return null;

    const nowMs = Date.now();
    const sanitizedTagId = args.tagId !== undefined ? resolvedTagId : existing.tagId;
    const shouldAutoStart = Boolean(args.autoStartNext && args.nextTimerRunId);

    const scheduleAndPatchNextInterval = async (
      runNext: boolean,
      lastCompletedRunId: string | undefined
    ) => {
      if (runNext && args.nextTimerRunId) {
        const scheduled = await scheduleCompletionJob(
          ctx,
          user._id,
          args.nextTimerRunId,
          args.nextDurationSeconds,
          nowMs
        );
        const runningPayload = {
          sessionType: args.nextSessionType,
          status: "RUNNING" as const,
          remainingSeconds: args.nextDurationSeconds,
          totalSeconds: args.nextDurationSeconds,
          targetEndTime: scheduled.targetEndTime,
          currentCycle: args.nextCurrentCycle,
          tagId: sanitizedTagId,
          timerRunId: args.nextTimerRunId,
          lastCompletedTimerRunId: lastCompletedRunId,
          scheduleNonce: scheduled.scheduleNonce,
          serverAutoStartStreak: 0,
          scheduledCompletionId: scheduled.scheduledCompletionId,
          updatedAtMs: nowMs,
        };
        await ctx.db.patch(existing._id, runningPayload);
        return runningPayload;
      }

      const idlePayload = {
        ...buildIdleTimerPayload({
          sessionType: args.nextSessionType,
          durationSeconds: args.nextDurationSeconds,
          currentCycle: args.nextCurrentCycle,
          lastCompletedTimerRunId: lastCompletedRunId,
          updatedAtMs: nowMs,
        }),
        tagId: sanitizedTagId,
      };
      await ctx.db.patch(existing._id, idlePayload);
      return idlePayload;
    };

    // Case 1: Server onTimerCompleted has NOT run yet — client beat it cleanly.
    if (
      existing.status === "RUNNING" &&
      (Boolean(args.completedTimerRunId) || !existing.timerRunId) &&
      (!existing.timerRunId || existing.timerRunId === args.completedTimerRunId)
    ) {
      if (existing.targetEndTime && nowMs < existing.targetEndTime - 5000) {
        return { ...existing, rejectedReason: "too_early" as const, serverNowMs: nowMs };
      }

      await cancelScheduledJob(ctx, existing.scheduledCompletionId);

      const completedRunId = existing.timerRunId || args.completedTimerRunId || undefined;
      const completedAtMs =
        existing.targetEndTime && existing.targetEndTime < nowMs ? existing.targetEndTime : nowMs;

      await recordCompletedSessionIfNotDuplicate(ctx, {
        userId: user._id,
        tagId: existing.tagId,
        sessionType: existing.sessionType,
        durationSeconds: existing.totalSeconds,
        completedAtMs,
        timerRunId: completedRunId,
      });

      const nextPayload = await scheduleAndPatchNextInterval(shouldAutoStart, completedRunId);

      await dispatchCompletionPushIfSubscribed(ctx, {
        userId: user._id,
        sessionType: existing.sessionType,
        timerRunId: completedRunId || `run-${nowMs}`,
        completedAtMs,
        targetEndTime: existing.targetEndTime,
        nowMs,
        maxWindowMs: 120_000,
      });

      return { ...nextPayload, serverNowMs: nowMs };
    }

    // Case 2a: Server onTimerCompleted already ran AND auto-started the next interval.
    if (
      existing.status === "RUNNING" &&
      Boolean(args.completedTimerRunId) &&
      existing.lastCompletedTimerRunId === args.completedTimerRunId
    ) {
      if ((existing.serverAutoStartStreak ?? 0) !== 0) {
        await ctx.db.patch(existing._id, { serverAutoStartStreak: 0 });
      }
      return { ...existing, serverAutoStartStreak: 0, serverNowMs: nowMs };
    }

    // Case 2b: onTimerCompleted ALREADY ran on the server and landed on IDLE (e.g. cap reached).
    const serverSettings = user.settings ?? DEFAULT_SETTINGS;
    const serverAllowsAutoStart =
      args.nextSessionType === "WORK"
        ? Boolean(serverSettings.autoStartPomodoros)
        : Boolean(serverSettings.autoStartBreaks);

    if (
      existing.status === "IDLE" &&
      shouldAutoStart &&
      serverAllowsAutoStart &&
      args.nextTimerRunId &&
      Boolean(args.completedTimerRunId) &&
      existing.lastCompletedTimerRunId === args.completedTimerRunId &&
      existing.sessionType === args.nextSessionType &&
      existing.currentCycle === args.nextCurrentCycle &&
      nowMs - existing.updatedAtMs < 60_000
    ) {
      const runningPayload = await scheduleAndPatchNextInterval(
        true,
        args.completedTimerRunId ?? undefined
      );
      return { ...runningPayload, serverNowMs: nowMs };
    }

    return { ...existing, serverNowMs: nowMs };
  },
});

export const onTimerCompleted = internalMutation({
  args: {
    userId: v.id("users"),
    timerRunId: v.string(),
    scheduleNonce: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const timer = await getUserActiveTimer(ctx, args.userId);
    if (!timer || timer.timerRunId !== args.timerRunId || timer.status !== "RUNNING") {
      return null;
    }

    if (
      args.scheduleNonce !== undefined &&
      timer.scheduleNonce !== undefined &&
      timer.scheduleNonce !== args.scheduleNonce
    ) {
      return null;
    }

    const nowMs = Date.now();
    const completedAtMs =
      timer.targetEndTime && timer.targetEndTime <= nowMs ? timer.targetEndTime : nowMs;

    await recordCompletedSessionIfNotDuplicate(ctx, {
      userId: args.userId,
      tagId: timer.tagId,
      sessionType: timer.sessionType,
      durationSeconds: timer.totalSeconds,
      completedAtMs,
      timerRunId: args.timerRunId,
    });

    const user = await ctx.db.get(args.userId);
    const settings = user?.settings ?? DEFAULT_SETTINGS;
    const { nextType, nextCycle, nextDurationSec, shouldAutoStart } = computeServerNextInterval(
      timer.sessionType,
      timer.currentCycle,
      settings
    );

    const currentStreak = timer.serverAutoStartStreak ?? 0;
    const willAutoStart =
      shouldAutoStart && currentStreak < MAX_UNATTENDED_SERVER_AUTO_STARTS;

    if (willAutoStart) {
      const nextTimerRunId = `run-srv-${nowMs}-${Math.random().toString(36).slice(2, 7)}`;
      const scheduled = await scheduleCompletionJob(
        ctx,
        args.userId,
        nextTimerRunId,
        nextDurationSec,
        nowMs
      );

      await ctx.db.patch(timer._id, {
        sessionType: nextType,
        status: "RUNNING" as const,
        remainingSeconds: nextDurationSec,
        totalSeconds: nextDurationSec,
        currentCycle: nextCycle,
        targetEndTime: scheduled.targetEndTime,
        timerRunId: nextTimerRunId,
        lastCompletedTimerRunId: args.timerRunId,
        scheduleNonce: scheduled.scheduleNonce,
        serverAutoStartStreak: currentStreak + 1,
        scheduledCompletionId: scheduled.scheduledCompletionId,
        updatedAtMs: nowMs,
      });
    } else {
      await ctx.db.patch(
        timer._id,
        buildIdleTimerPayload({
          sessionType: nextType,
          durationSeconds: nextDurationSec,
          currentCycle: nextCycle,
          lastCompletedTimerRunId: args.timerRunId,
          updatedAtMs: nowMs,
        })
      );
    }

    await dispatchCompletionPushIfSubscribed(ctx, {
      userId: args.userId,
      sessionType: timer.sessionType,
      timerRunId: args.timerRunId,
      completedAtMs,
      targetEndTime: timer.targetEndTime,
      nowMs,
      maxWindowMs: 180_000,
    });

    return null;
  },
});

export const cleanupStaleTimers = internalMutation({
  args: {},
  returns: v.object({ cleanedCount: v.number() }),
  handler: async (ctx) => {
    const nowMs = Date.now();
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

    const runningTimers = await ctx.db
      .query("active_timers")
      .withIndex("by_status_updated", (q) => q.eq("status", "RUNNING"))
      .take(500);

    const stalePausedTimers = await ctx.db
      .query("active_timers")
      .withIndex("by_status_updated", (q) =>
        q.eq("status", "PAUSED").lt("updatedAtMs", nowMs - SEVEN_DAYS_MS)
      )
      .take(500);

    let cleanedCount = 0;

    for (const timer of [...runningTimers, ...stalePausedTimers]) {
      const isAbandonedRunning =
        timer.status === "RUNNING" &&
        timer.targetEndTime !== undefined &&
        nowMs > timer.targetEndTime + ONE_HOUR_MS;
      const isAbandonedPaused =
        timer.status === "PAUSED" && nowMs - timer.updatedAtMs > SEVEN_DAYS_MS;

      if (!isAbandonedRunning && !isAbandonedPaused) continue;

      await cancelScheduledJob(ctx, timer.scheduledCompletionId);

      const user = await ctx.db.get(timer.userId);
      const settings = user?.settings ?? DEFAULT_SETTINGS;
      const dur = Math.max(1, Math.round(settings.workDurationMinutes * 60));

      await ctx.db.patch(
        timer._id,
        buildIdleTimerPayload({
          sessionType: "WORK",
          durationSeconds: dur,
          currentCycle: 1,
          updatedAtMs: nowMs,
        })
      );
      cleanedCount++;
    }

    return { cleanedCount };
  },
});

import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { requireUser, getAuthenticatedUser, DEFAULT_SETTINGS } from "./authHelper";
import {
  assertValidCycle,
  assertValidDurationSeconds,
  assertValidRemainingSeconds,
  assertValidTagId,
  assertValidTimerRunId,
  cancelScheduledJob,
  computeServerNextInterval,
  reconcileCompletedSessionAttempt,
  recordCompletedSessionIfNotDuplicate,
} from "./timerHelpers";

export const getActive = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return null;

    const timer = await ctx.db
      .query("active_timers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    if (!timer) {
      return null;
    }

    return {
      sessionType: timer.sessionType,
      status: timer.status,
      remainingSeconds: timer.remainingSeconds,
      totalSeconds: timer.totalSeconds,
      targetEndTime: timer.targetEndTime ?? null,
      currentCycle: timer.currentCycle,
      activeTagId: timer.tagId ?? null,
      timerRunId: timer.timerRunId ?? null,
      updatedAtMs: timer.updatedAtMs,
    };
  },
});

export const start = mutation({
  args: {
    sessionType: v.union(
      v.literal("WORK"),
      v.literal("SHORT_BREAK"),
      v.literal("LONG_BREAK")
    ),
    durationSeconds: v.number(),
    remainingSeconds: v.optional(v.number()),
    totalSeconds: v.optional(v.number()),
    currentCycle: v.number(),
    tagId: v.optional(v.union(v.string(), v.null())),
    timerRunId: v.string(),
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
    assertValidTagId(args.tagId);

    const now = Date.now();
    const remaining = Math.max(1, args.remainingSeconds ?? args.durationSeconds);
    const total = Math.max(remaining, args.totalSeconds ?? args.durationSeconds);
    const targetEndTime = now + remaining * 1000;
    const sanitizedTagId = args.tagId || undefined;

    const existing = await ctx.db
      .query("active_timers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    await cancelScheduledJob(ctx, existing?.scheduledCompletionId);

    // Schedule authoritative server-side completion trigger
    const scheduledCompletionId = await ctx.scheduler.runAfter(
      remaining * 1000,
      internal.timer.onTimerCompleted,
      {
        userId: user._id,
        timerRunId: args.timerRunId,
      }
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
      updatedAtMs: now,
      scheduledCompletionId,
    };

    if (existing) {
      await ctx.db.patch(existing._id, timerPayload);
    } else {
      await ctx.db.insert("active_timers", timerPayload);
    }

    return timerPayload;
  },
});

export const pause = mutation({
  args: {
    remainingSeconds: v.number(),
    tagId: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args): Promise<any> => {
    const user = await requireUser(ctx);
    assertValidRemainingSeconds(args.remainingSeconds, "remainingSeconds");
    assertValidTagId(args.tagId);

    const existing = await ctx.db
      .query("active_timers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    if (!existing) return null;

    const sanitizedRemaining = Math.max(0, args.remainingSeconds);
    const nextTagId = args.tagId !== undefined ? (args.tagId || undefined) : existing.tagId;
    if (
      existing.status === "PAUSED" &&
      existing.remainingSeconds === sanitizedRemaining &&
      (existing.tagId ?? undefined) === nextTagId
    ) {
      return existing;
    }

    await cancelScheduledJob(ctx, existing.scheduledCompletionId);

    const updates = {
      status: "PAUSED" as const,
      remainingSeconds: sanitizedRemaining,
      tagId: nextTagId,
      targetEndTime: undefined,
      scheduledCompletionId: undefined,
      updatedAtMs: Date.now(),
    };

    await ctx.db.patch(existing._id, updates);
    return updates;
  },
});

export const reset = mutation({
  args: {
    sessionType: v.union(
      v.literal("WORK"),
      v.literal("SHORT_BREAK"),
      v.literal("LONG_BREAK")
    ),
    durationSeconds: v.number(),
    currentCycle: v.number(),
    tagId: v.optional(v.union(v.string(), v.null())),
    onlyIfNotRunning: v.optional(v.boolean()),
    expectedTimerRunId: v.optional(v.string()),
    expectedUpdatedAtMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, true);
    assertValidDurationSeconds(args.durationSeconds, "durationSeconds");
    assertValidCycle(args.currentCycle, "currentCycle");
    assertValidTagId(args.tagId);
    assertValidTimerRunId(args.expectedTimerRunId, "expectedTimerRunId");
    if (args.expectedUpdatedAtMs !== undefined && !Number.isFinite(args.expectedUpdatedAtMs)) {
      throw new Error("Invalid expectedUpdatedAtMs.");
    }
    const sanitizedTagId = args.tagId || undefined;

    const existing = await ctx.db
      .query("active_timers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    // Prevent stale/background resets from clobbering an active or newer timer
    if (args.onlyIfNotRunning && existing && existing.status === "RUNNING") {
      return existing;
    }
    if (args.expectedTimerRunId !== undefined && existing?.timerRunId !== args.expectedTimerRunId) {
      return existing ?? null;
    }
    if (
      args.expectedUpdatedAtMs !== undefined &&
      existing &&
      existing.updatedAtMs > args.expectedUpdatedAtMs
    ) {
      return existing;
    }

    if (
      existing &&
      existing.status === "IDLE" &&
      existing.sessionType === args.sessionType &&
      existing.remainingSeconds === args.durationSeconds &&
      existing.totalSeconds === args.durationSeconds &&
      existing.currentCycle === args.currentCycle &&
      (existing.tagId ?? undefined) === sanitizedTagId
    ) {
      return existing;
    }

    await cancelScheduledJob(ctx, existing?.scheduledCompletionId);

    const resetPayload = {
      sessionType: args.sessionType,
      status: "IDLE" as const,
      remainingSeconds: args.durationSeconds,
      totalSeconds: args.durationSeconds,
      targetEndTime: undefined,
      currentCycle: args.currentCycle,
      tagId: sanitizedTagId,
      timerRunId: undefined,
      scheduledCompletionId: undefined,
      updatedAtMs: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, resetPayload);
    } else {
      await ctx.db.insert("active_timers", {
        userId: user._id,
        ...resetPayload,
      });
    }

    return resetPayload;
  },
});

export const complete = mutation({
  args: {
    completedTimerRunId: v.optional(v.union(v.string(), v.null())),
    nextSessionType: v.union(
      v.literal("WORK"),
      v.literal("SHORT_BREAK"),
      v.literal("LONG_BREAK")
    ),
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
    assertValidTimerRunId(args.nextTimerRunId, "nextTimerRunId");
    assertValidTagId(args.tagId);

    const existing = await ctx.db
      .query("active_timers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    if (!existing) {
      return null;
    }

    const nowMs = Date.now();
    const sanitizedTagId = args.tagId !== undefined ? (args.tagId || undefined) : existing.tagId;
    const shouldAutoStart = Boolean(args.autoStartNext && args.nextTimerRunId);

    // Case 1: Server onTimerCompleted has NOT run yet — client beat it cleanly.
    if (
      existing.status === "RUNNING" &&
      (Boolean(args.completedTimerRunId) || !existing.timerRunId) &&
      (!existing.timerRunId || existing.timerRunId === args.completedTimerRunId)
    ) {
      if (existing.targetEndTime && nowMs < existing.targetEndTime - 5000) {
        return existing;
      }

      await cancelScheduledJob(ctx, existing.scheduledCompletionId);

      const completedAtMs =
        existing.targetEndTime && existing.targetEndTime < nowMs
          ? existing.targetEndTime
          : nowMs;
      const completedAtIso = new Date(completedAtMs).toISOString();

      await recordCompletedSessionIfNotDuplicate(ctx, {
        userId: user._id,
        tagId: existing.tagId,
        sessionType: existing.sessionType,
        durationSeconds: existing.totalSeconds,
        completedAtMs,
      });

      await reconcileCompletedSessionAttempt(ctx, {
        userId: user._id,
        attemptId: existing.timerRunId || args.completedTimerRunId,
        totalSeconds: existing.totalSeconds,
        targetEndTime: existing.targetEndTime,
        completedAtIso,
        nowMs,
        source: "client",
      });

      let nextScheduledCompletionId: Id<"_scheduled_functions"> | undefined;
      let nextTargetEndTime: number | undefined;
      let nextTimerRunId: string | undefined;

      if (shouldAutoStart && args.nextTimerRunId) {
        nextTimerRunId = args.nextTimerRunId;
        nextTargetEndTime = nowMs + args.nextDurationSeconds * 1000;
        nextScheduledCompletionId = await ctx.scheduler.runAfter(
          args.nextDurationSeconds * 1000,
          internal.timer.onTimerCompleted,
          {
            userId: user._id,
            timerRunId: nextTimerRunId,
          }
        );
      }

      const nextPayload = {
        sessionType: args.nextSessionType,
        status: shouldAutoStart ? ("RUNNING" as const) : ("IDLE" as const),
        remainingSeconds: args.nextDurationSeconds,
        totalSeconds: args.nextDurationSeconds,
        targetEndTime: nextTargetEndTime,
        currentCycle: args.nextCurrentCycle,
        tagId: sanitizedTagId,
        timerRunId: nextTimerRunId,
        scheduledCompletionId: nextScheduledCompletionId,
        updatedAtMs: nowMs,
      };

      await ctx.db.patch(existing._id, nextPayload);

      const withinPushFreshnessWindow =
        !existing.targetEndTime || nowMs - existing.targetEndTime <= 120_000;
      if (withinPushFreshnessWindow) {
        const hasPushSub = Boolean(
          await ctx.db
            .query("push_subscriptions")
            .withIndex("by_user_device", (q) => q.eq("userId", user._id))
            .first()
        );
        if (hasPushSub) {
          await ctx.scheduler.runAfter(0, internal.pushActions.sendTimerCompletionPush, {
            userId: user._id,
            sessionType: existing.sessionType,
            timerRunId: existing.timerRunId || args.completedTimerRunId || `run-${nowMs}`,
            completedAtMs: Math.round(completedAtMs),
          });
        }
      }

      return nextPayload;
    }

    // Case 2: onTimerCompleted ALREADY ran on the server (so push was already scheduled).
    if (
      existing.status === "IDLE" &&
      shouldAutoStart &&
      args.nextTimerRunId &&
      existing.sessionType === args.nextSessionType &&
      existing.currentCycle === args.nextCurrentCycle &&
      nowMs - existing.updatedAtMs < 120_000
    ) {
      const nextTargetEndTime = nowMs + args.nextDurationSeconds * 1000;
      const nextScheduledCompletionId: Id<"_scheduled_functions"> = await ctx.scheduler.runAfter(
        args.nextDurationSeconds * 1000,
        internal.timer.onTimerCompleted,
        {
          userId: user._id,
          timerRunId: args.nextTimerRunId,
        }
      );

      const runningPayload = {
        sessionType: args.nextSessionType,
        status: "RUNNING" as const,
        remainingSeconds: args.nextDurationSeconds,
        totalSeconds: args.nextDurationSeconds,
        targetEndTime: nextTargetEndTime,
        currentCycle: args.nextCurrentCycle,
        tagId: sanitizedTagId,
        timerRunId: args.nextTimerRunId,
        scheduledCompletionId: nextScheduledCompletionId,
        updatedAtMs: nowMs,
      };
      await ctx.db.patch(existing._id, runningPayload);
      return runningPayload;
    }

    return existing;
  },
});

export const onTimerCompleted = internalMutation({
  args: {
    userId: v.id("users"),
    timerRunId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const timer = await ctx.db
      .query("active_timers")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    if (!timer || timer.timerRunId !== args.timerRunId || timer.status !== "RUNNING") {
      return null;
    }

    const nowMs = Date.now();
    const completedAtMs =
      timer.targetEndTime && timer.targetEndTime <= nowMs
        ? timer.targetEndTime
        : nowMs;
    const completedAtIso = new Date(completedAtMs).toISOString();

    await recordCompletedSessionIfNotDuplicate(ctx, {
      userId: args.userId,
      tagId: timer.tagId,
      sessionType: timer.sessionType,
      durationSeconds: timer.totalSeconds,
      completedAtMs,
    });

    await reconcileCompletedSessionAttempt(ctx, {
      userId: args.userId,
      attemptId: timer.timerRunId,
      totalSeconds: timer.totalSeconds,
      targetEndTime: timer.targetEndTime,
      completedAtIso,
      nowMs,
      source: "server_scheduled",
    });

    const user = await ctx.db.get(args.userId);
    const settings = user?.settings ?? DEFAULT_SETTINGS;
    const { nextType, nextCycle, nextDurationSec } = computeServerNextInterval(
      timer.sessionType,
      timer.currentCycle,
      settings
    );

    await ctx.db.patch(timer._id, {
      sessionType: nextType,
      status: "IDLE" as const,
      remainingSeconds: nextDurationSec,
      totalSeconds: nextDurationSec,
      currentCycle: nextCycle,
      targetEndTime: undefined,
      timerRunId: undefined,
      scheduledCompletionId: undefined,
      updatedAtMs: nowMs,
    });

    const withinPushFreshnessWindow =
      !timer.targetEndTime || nowMs - timer.targetEndTime <= 180_000;
    if (withinPushFreshnessWindow) {
      const hasPushSub = Boolean(
        await ctx.db
          .query("push_subscriptions")
          .withIndex("by_user_device", (q) => q.eq("userId", args.userId))
          .first()
      );
      if (hasPushSub) {
        await ctx.scheduler.runAfter(0, internal.pushActions.sendTimerCompletionPush, {
          userId: args.userId,
          sessionType: timer.sessionType,
          timerRunId: args.timerRunId,
          completedAtMs: Math.round(completedAtMs),
        });
      }
    }

    return null;
  },
});

/**
 * Scheduled background maintenance task:
 * 1. Resets abandoned RUNNING timers (targetEndTime passed by > 1 hour) to IDLE.
 * 2. Resets ancient PAUSED timers (> 7 days stale) to IDLE.
 * 3. Clears stale peerPresence records (> 24 hours old).
 */
export const cleanupStaleTimers = internalMutation({
  args: {},
  returns: v.object({
    cleanedCount: v.number(),
  }),
  handler: async (ctx) => {
    const nowMs = Date.now();
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    const allTimers = await ctx.db.query("active_timers").take(1024);
    let cleanedCount = 0;

    for (const timer of allTimers) {
      const isAbandonedRunning =
        timer.status === "RUNNING" &&
        timer.targetEndTime !== undefined &&
        nowMs > timer.targetEndTime + ONE_HOUR_MS;
      const isAbandonedPaused =
        timer.status === "PAUSED" && nowMs - timer.updatedAtMs > SEVEN_DAYS_MS;

      if (isAbandonedRunning || isAbandonedPaused) {
        if (timer.timerRunId) {
          const runId = timer.timerRunId;
          const existingAttempt = await ctx.db
            .query("session_attempts")
            .withIndex("by_user_attempt", (q) =>
              q.eq("userId", timer.userId).eq("attemptId", runId)
            )
            .first();

          if (existingAttempt && existingAttempt.status === "in_progress") {
            const plannedSec = Math.max(
              1,
              existingAttempt.plannedDurationSeconds || timer.totalSeconds || 1
            );
            const isExpiredRunning =
              timer.status === "RUNNING" &&
              typeof timer.targetEndTime === "number" &&
              timer.targetEndTime < nowMs;
            const endedMs = isExpiredRunning ? timer.targetEndTime! : nowMs;
            const actualActiveSeconds = isExpiredRunning
              ? plannedSec
              : Math.max(0, Math.min(plannedSec, existingAttempt.actualActiveSeconds));
            const remainingSecondsAtEnd = Math.max(0, plannedSec - actualActiveSeconds);
            const completionRatio = Number(
              Math.min(1, actualActiveSeconds / plannedSec).toFixed(4)
            );

            await ctx.db.patch(existingAttempt._id, {
              status: "abandoned_stale",
              endedAt: new Date(endedMs).toISOString(),
              actualActiveSeconds,
              remainingSecondsAtEnd,
              completionRatio,
              source: "server_scheduled",
              updatedAtMs: nowMs,
            });
          }
        }

        const user = await ctx.db.get(timer.userId);
        const settings = user?.settings ?? DEFAULT_SETTINGS;
        const dur = Math.max(1, Math.round(settings.workDurationMinutes * 60));

        await ctx.db.patch(timer._id, {
          sessionType: "WORK",
          status: "IDLE",
          remainingSeconds: dur,
          totalSeconds: dur,
          currentCycle: 1,
          targetEndTime: undefined,
          timerRunId: undefined,
          scheduledCompletionId: undefined,
          updatedAtMs: nowMs,
        });
        cleanedCount++;
      } else if (
        timer.peerPresence &&
        nowMs - (timer.peerPresence.lastSeenMs || 0) > ONE_DAY_MS
      ) {
        await ctx.db.patch(timer._id, {
          peerPresence: undefined,
        });
        cleanedCount++;
      }
    }

    return { cleanedCount };
  },
});

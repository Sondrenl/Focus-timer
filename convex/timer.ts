import { v } from "convex/values";
import { query, mutation, internalMutation, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { requireUser, getAuthenticatedUser, DEFAULT_SETTINGS } from "./authHelper";

async function cancelScheduledJob(
  ctx: MutationCtx,
  jobId: Id<"_scheduled_functions"> | undefined
) {
  if (jobId) {
    try {
      await ctx.scheduler.cancel(jobId);
    } catch {
      // Ignore if already completed or expired
    }
  }
}

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
      peerPresence: timer.peerPresence ?? null,
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
    if (!Number.isFinite(args.durationSeconds) || args.durationSeconds < 1 || args.durationSeconds > 86400) {
      throw new Error("durationSeconds must be between 1 and 86400.");
    }
    if (args.remainingSeconds !== undefined && (!Number.isFinite(args.remainingSeconds) || args.remainingSeconds < 0 || args.remainingSeconds > 86400)) {
      throw new Error("remainingSeconds must be between 0 and 86400.");
    }
    if (args.totalSeconds !== undefined && (!Number.isFinite(args.totalSeconds) || args.totalSeconds < 1 || args.totalSeconds > 86400)) {
      throw new Error("totalSeconds must be between 1 and 86400.");
    }
    if (!Number.isFinite(args.currentCycle) || args.currentCycle < 1 || args.currentCycle > 100) {
      throw new Error("currentCycle must be between 1 and 100.");
    }
    if (!args.timerRunId || args.timerRunId.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(args.timerRunId)) {
      throw new Error("Invalid timerRunId format.");
    }
    if (args.tagId && (args.tagId.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(args.tagId))) {
      throw new Error("Invalid tagId format.");
    }

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
    if (!Number.isFinite(args.remainingSeconds) || args.remainingSeconds < 0 || args.remainingSeconds > 86400) {
      throw new Error("remainingSeconds must be between 0 and 86400.");
    }
    if (args.tagId && (args.tagId.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(args.tagId))) {
      throw new Error("Invalid tagId format.");
    }
    const existing = await ctx.db
      .query("active_timers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    if (!existing) return null;

    const sanitizedRemaining = Math.max(0, args.remainingSeconds);
    const nextTagId = args.tagId !== undefined ? (args.tagId || undefined) : existing.tagId;
    // Capacity optimization: skip redundant patch if already paused at identical remaining seconds
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

export const resume = mutation({
  args: {
    remainingSeconds: v.number(),
  },
  handler: async (ctx, args): Promise<any> => {
    const user = await requireUser(ctx);
    if (!Number.isFinite(args.remainingSeconds) || args.remainingSeconds < 1 || args.remainingSeconds > 86400) {
      throw new Error("remainingSeconds must be between 1 and 86400.");
    }
    const existing = await ctx.db
      .query("active_timers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    if (!existing) return null;

    await cancelScheduledJob(ctx, existing.scheduledCompletionId);

    const durationSeconds = Math.max(1, args.remainingSeconds);
    const now = Date.now();
    const targetEndTime = now + durationSeconds * 1000;
    const timerRunId = existing.timerRunId || `run-${now}`;

    const scheduledCompletionId = await ctx.scheduler.runAfter(
      durationSeconds * 1000,
      internal.timer.onTimerCompleted,
      {
        userId: user._id,
        timerRunId,
      }
    );

    const updates = {
      status: "RUNNING" as const,
      remainingSeconds: durationSeconds,
      targetEndTime,
      timerRunId,
      scheduledCompletionId,
      updatedAtMs: now,
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
  handler: async (ctx, args): Promise<any> => {
    const user = await requireUser(ctx, true);
    if (!Number.isFinite(args.durationSeconds) || args.durationSeconds < 1 || args.durationSeconds > 86400) {
      throw new Error("durationSeconds must be between 1 and 86400.");
    }
    if (!Number.isFinite(args.currentCycle) || args.currentCycle < 1 || args.currentCycle > 100) {
      throw new Error("currentCycle must be between 1 and 100.");
    }
    if (args.tagId && (args.tagId.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(args.tagId))) {
      throw new Error("Invalid tagId format.");
    }
    if (
      args.expectedTimerRunId &&
      (args.expectedTimerRunId.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(args.expectedTimerRunId))
    ) {
      throw new Error("Invalid expectedTimerRunId format.");
    }
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

    // Capacity optimization: skip redundant patch if already IDLE with identical parameters
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
    if (!Number.isFinite(args.nextDurationSeconds) || args.nextDurationSeconds < 1 || args.nextDurationSeconds > 86400) {
      throw new Error("nextDurationSeconds must be between 1 and 86400.");
    }
    if (!Number.isFinite(args.nextCurrentCycle) || args.nextCurrentCycle < 1 || args.nextCurrentCycle > 100) {
      throw new Error("nextCurrentCycle must be between 1 and 100.");
    }
    if (args.nextTimerRunId && (args.nextTimerRunId.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(args.nextTimerRunId))) {
      throw new Error("Invalid nextTimerRunId format.");
    }
    if (args.tagId && (args.tagId.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(args.tagId))) {
      throw new Error("Invalid tagId format.");
    }

    const existing = await ctx.db
      .query("active_timers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    if (!existing) {
      return null;
    }

    const nowMs = Date.now();
    const settings = user.settings ?? DEFAULT_SETTINGS;
    const sanitizedTagId = args.tagId !== undefined ? (args.tagId || undefined) : existing.tagId;
    const shouldAutoStart = Boolean(args.autoStartNext && args.nextTimerRunId);

    // Case 1: Server onTimerCompleted has NOT run yet — client beat it cleanly.
    if (
      existing.status === "RUNNING" &&
      (!existing.timerRunId || existing.timerRunId === args.completedTimerRunId)
    ) {
      // Guard against premature completion calls more than 5s before targetEndTime
      if (existing.targetEndTime && nowMs < existing.targetEndTime - 5000) {
        return existing;
      }

      await cancelScheduledJob(ctx, existing.scheduledCompletionId);

      const completedAtMs =
        existing.targetEndTime && existing.targetEndTime < nowMs
          ? existing.targetEndTime
          : nowMs;
      const completedAtIso = new Date(completedAtMs).toISOString();

      // Record completed session if not already recorded within ±45s
      const recent = await ctx.db
        .query("sessions")
        .withIndex("by_user_completed", (q) =>
          q
            .eq("userId", user._id)
            .gte("completedAt", new Date(completedAtMs - 45000).toISOString())
            .lte("completedAt", new Date(completedAtMs + 45000).toISOString())
        )
        .take(50);

      const alreadyRecorded = recent.some(
        (s) =>
          s.sessionType === existing.sessionType &&
          Math.abs(Date.parse(s.completedAt) - completedAtMs) <= 45000
      );
      if (!alreadyRecorded) {
        await ctx.db.insert("sessions", {
          userId: user._id,
          tagId: existing.tagId,
          sessionType: existing.sessionType,
          durationSeconds: existing.totalSeconds,
          completedAt: completedAtIso,
        });
      }

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

      // Dispatch push notification for the completed run (unless already >2m stale)
      const withinPushFreshnessWindow =
        !existing.targetEndTime || nowMs - existing.targetEndTime <= 120_000;
      if (settings.notificationsEnabled !== false && withinPushFreshnessWindow) {
        await ctx.scheduler.runAfter(0, internal.pushActions.sendTimerCompletionPush, {
          userId: user._id,
          sessionType: existing.sessionType,
          timerRunId: existing.timerRunId || args.completedTimerRunId || `run-${nowMs}`,
          completedAtMs: nowMs,
        });
      }

      return nextPayload;
    }

    // Case 2: onTimerCompleted ALREADY ran on the server (so push was already scheduled).
    // If autoStartNext is enabled and the server just transitioned to IDLE for this interval, start the next run.
    if (
      existing.status === "IDLE" &&
      shouldAutoStart &&
      args.nextTimerRunId &&
      existing.sessionType === args.nextSessionType &&
      existing.currentCycle === args.nextCurrentCycle &&
      nowMs - existing.updatedAtMs < 120_000
    ) {
      const nextTargetEndTime = nowMs + args.nextDurationSeconds * 1000;
      const nextScheduledCompletionId = await ctx.scheduler.runAfter(
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

export const updatePresence = mutation({
  args: {
    isMobile: v.boolean(),
    isVisible: v.boolean(),
  },
  handler: async (ctx, args): Promise<any> => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return null;
    const existing = await ctx.db
      .query("active_timers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    if (!existing) return null;

    const currentPresence = existing.peerPresence ?? {
      desktopActive: false,
      desktopVisible: false,
      mobileActive: false,
      mobileVisible: false,
      lastSeenMs: 0,
    };

    const newDesktopActive = args.isMobile ? currentPresence.desktopActive : true;
    const newDesktopVisible = args.isMobile ? currentPresence.desktopVisible : args.isVisible;
    const newMobileActive = args.isMobile ? true : currentPresence.mobileActive;
    const newMobileVisible = args.isMobile ? args.isVisible : currentPresence.mobileVisible;

    const flagsChanged =
      newDesktopActive !== currentPresence.desktopActive ||
      newDesktopVisible !== currentPresence.desktopVisible ||
      newMobileActive !== currentPresence.mobileActive ||
      newMobileVisible !== currentPresence.mobileVisible;

    const now = Date.now();
    // Capacity optimization: skip redundant patch if presence flags didn't change and heartbeat is fresh (<60s)
    if (!flagsChanged && now - currentPresence.lastSeenMs < 60000) {
      return currentPresence;
    }

    const updatedPresence = {
      desktopActive: newDesktopActive,
      desktopVisible: newDesktopVisible,
      mobileActive: newMobileActive,
      mobileVisible: newMobileVisible,
      lastSeenMs: now,
    };

    await ctx.db.patch(existing._id, {
      peerPresence: updatedPresence,
    });

    return updatedPresence;
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

    // Verify this is still the active run
    if (!timer || timer.timerRunId !== args.timerRunId || timer.status !== "RUNNING") {
      return null;
    }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    // 1. Record completed session in sessions table (if not already recorded)
    const recent = await ctx.db
      .query("sessions")
      .withIndex("by_user_completed", (q) =>
        q
          .eq("userId", args.userId)
          .gte("completedAt", new Date(nowMs - 45000).toISOString())
          .lte("completedAt", new Date(nowMs + 45000).toISOString())
      )
      .take(50);

    const alreadyRecorded = recent.some((s) => s.sessionType === timer.sessionType);
    if (!alreadyRecorded) {
      await ctx.db.insert("sessions", {
        userId: args.userId,
        tagId: timer.tagId,
        sessionType: timer.sessionType,
        durationSeconds: timer.totalSeconds,
        completedAt: nowIso,
      });
    }

    // 1b. Reconcile passive ML telemetry attempt & record server completion event
    if (timer.timerRunId) {
      const existingAttempt = await ctx.db
        .query("session_attempts")
        .withIndex("by_user_attempt", (q) =>
          q.eq("userId", args.userId).eq("attemptId", args.timerRunId)
        )
        .first();

      const completionLatencySeconds = timer.targetEndTime
        ? Math.max(0, Math.round((nowMs - timer.targetEndTime) / 1000))
        : 0;
      const actualActiveSeconds =
        existingAttempt?.plannedDurationSeconds || timer.totalSeconds;

      if (existingAttempt && existingAttempt.status === "in_progress") {
        await ctx.db.patch(existingAttempt._id, {
          status: "completed",
          endedAt: nowIso,
          actualActiveSeconds,
          remainingSecondsAtEnd: 0,
          completionRatio: 1,
          completionLatencySeconds,
          source: "server_scheduled",
          updatedAtMs: nowMs,
        });
      }
    }

    // 2. Advance active_timers to the next interval in IDLE status
    const user = await ctx.db.get(args.userId);
    const settings = user?.settings ?? DEFAULT_SETTINGS;
    const interval = Math.max(1, settings.longBreakInterval || 4);
    const curCycle = Math.max(1, timer.currentCycle || 1);

    let nextType: "WORK" | "SHORT_BREAK" | "LONG_BREAK";
    let nextCycle: number;
    if (timer.sessionType === "WORK") {
      if (curCycle >= interval) {
        nextType = "LONG_BREAK";
        nextCycle = curCycle;
      } else {
        nextType = "SHORT_BREAK";
        nextCycle = curCycle;
      }
    } else if (timer.sessionType === "LONG_BREAK") {
      nextType = "WORK";
      nextCycle = 1;
    } else {
      nextType = "WORK";
      nextCycle = curCycle >= interval ? 1 : curCycle + 1;
    }

    const nextMinutes =
      nextType === "WORK"
        ? settings.workDurationMinutes
        : nextType === "SHORT_BREAK"
        ? settings.shortBreakDurationMinutes
        : settings.longBreakDurationMinutes;
    const nextDurationSec = Math.max(1, Math.round(nextMinutes * 60));

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

    if (settings.notificationsEnabled !== false) {
      await ctx.scheduler.runAfter(0, internal.pushActions.sendTimerCompletionPush, {
        userId: args.userId,
        sessionType: timer.sessionType,
        timerRunId: args.timerRunId,
        completedAtMs: nowMs,
      });
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

    // Bounded scan to prevent exceeding transaction limits
    const allTimers = await ctx.db.query("active_timers").take(1024);
    let cleanedCount = 0;

    for (const timer of allTimers) {
      let needsReset = false;

      // Abandoned RUNNING timer whose completion never executed
      if (
        timer.status === "RUNNING" &&
        timer.targetEndTime &&
        nowMs > timer.targetEndTime + ONE_HOUR_MS
      ) {
        needsReset = true;
      }

      // Abandoned PAUSED timer stale for more than 7 days
      if (
        timer.status === "PAUSED" &&
        nowMs - timer.updatedAtMs > SEVEN_DAYS_MS
      ) {
        needsReset = true;
      }

      if (needsReset) {
        if (timer.timerRunId) {
          const runId = timer.timerRunId;
          const existingAttempt = await ctx.db
            .query("session_attempts")
            .withIndex("by_user_attempt", (q) =>
              q.eq("userId", timer.userId).eq("attemptId", runId)
            )
            .first();

          if (existingAttempt && existingAttempt.status === "in_progress") {
            const nowIso = new Date(nowMs).toISOString();
            await ctx.db.patch(existingAttempt._id, {
              status: "abandoned_stale",
              endedAt: nowIso,
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
        // Clear ancient presence heartbeat to reduce payload size
        await ctx.db.patch(timer._id, {
          peerPresence: undefined,
        });
        cleanedCount++;
      }
    }

    return { cleanedCount };
  },
});

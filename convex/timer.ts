import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireUser, getAuthenticatedUser } from "./authHelper";

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
      return {
        sessionType: "WORK" as const,
        status: "IDLE" as const,
        remainingSeconds: 25 * 60,
        totalSeconds: 25 * 60,
        targetEndTime: null,
        currentCycle: 1,
        activeTagId: null,
        timerRunId: null,
        updatedAtMs: Date.now(),
      };
    }

    // If RUNNING and targetEndTime is in the past, calculate dynamically or mark completed
    let computedRemaining = timer.remainingSeconds;
    if (timer.status === "RUNNING" && timer.targetEndTime) {
      computedRemaining = Math.max(0, Math.round((timer.targetEndTime - Date.now()) / 1000));
    }

    return {
      sessionType: timer.sessionType,
      status: timer.status,
      remainingSeconds: computedRemaining,
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
    currentCycle: v.number(),
    tagId: v.optional(v.string()),
    timerRunId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, true);
    const now = Date.now();
    const targetEndTime = now + args.durationSeconds * 1000;

    const existing = await ctx.db
      .query("active_timers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    if (existing?.scheduledCompletionId) {
      try {
        await ctx.scheduler.cancel(existing.scheduledCompletionId);
      } catch (err) {
        console.warn("Could not cancel prior scheduled completion:", err);
      }
    }

    // Schedule server-side timer completion callback
    const scheduledCompletionId = await ctx.scheduler.runAfter(
      args.durationSeconds * 1000,
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
      remainingSeconds: args.durationSeconds,
      totalSeconds: args.durationSeconds,
      targetEndTime,
      currentCycle: args.currentCycle,
      tagId: args.tagId,
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
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const existing = await ctx.db
      .query("active_timers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    if (!existing) return null;

    if (existing.scheduledCompletionId) {
      try {
        await ctx.scheduler.cancel(existing.scheduledCompletionId);
      } catch (err) {
        console.warn("Could not cancel scheduled completion:", err);
      }
    }

    const updates = {
      status: "PAUSED" as const,
      remainingSeconds: Math.max(0, args.remainingSeconds),
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
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const existing = await ctx.db
      .query("active_timers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    if (!existing) return null;

    if (existing.scheduledCompletionId) {
      try {
        await ctx.scheduler.cancel(existing.scheduledCompletionId);
      } catch (err) {}
    }

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
    tagId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, true);
    const existing = await ctx.db
      .query("active_timers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    if (existing?.scheduledCompletionId) {
      try {
        await ctx.scheduler.cancel(existing.scheduledCompletionId);
      } catch (err) {}
    }

    const resetPayload = {
      sessionType: args.sessionType,
      status: "IDLE" as const,
      remainingSeconds: args.durationSeconds,
      totalSeconds: args.durationSeconds,
      targetEndTime: undefined,
      currentCycle: args.currentCycle,
      tagId: args.tagId,
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

export const onTimerCompleted = internalMutation({
  args: {
    userId: v.id("users"),
    timerRunId: v.string(),
  },
  handler: async (ctx, args) => {
    const timer = await ctx.db
      .query("active_timers")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    // Verify this is still the active run (prevent race conditions)
    if (!timer || timer.timerRunId !== args.timerRunId || timer.status !== "RUNNING") {
      return;
    }

    const now = new Date().toISOString();

    // 1. Record completed session automatically in database
    await ctx.db.insert("sessions", {
      userId: args.userId,
      tagId: timer.tagId,
      sessionType: timer.sessionType,
      durationSeconds: timer.totalSeconds,
      completedAt: now,
    });

    // 2. Mark timer as COMPLETED
    await ctx.db.patch(timer._id, {
      status: "COMPLETED" as const,
      remainingSeconds: 0,
      targetEndTime: undefined,
      scheduledCompletionId: undefined,
      updatedAtMs: Date.now(),
    });
  },
});

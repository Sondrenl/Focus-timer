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
  },
  handler: async (ctx, args): Promise<any> => {
    const user = await requireUser(ctx, true);
    const sanitizedTagId = args.tagId || undefined;

    const existing = await ctx.db
      .query("active_timers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

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
  handler: async (ctx, args): Promise<any> => {
    const timer = await ctx.db
      .query("active_timers")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    // Verify this is still the active run
    if (!timer || timer.timerRunId !== args.timerRunId || timer.status !== "RUNNING") {
      return;
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
      )
      .collect();

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
  },
});

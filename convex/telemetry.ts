import { v } from "convex/values";
import { query, mutation, internalMutation, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { requireUser, getAuthenticatedUser } from "./authHelper";
import {
  ID_REGEX,
  sessionAttemptInputFields,
  sessionAttemptReturnValidator,
  mlEventInputValidator,
  mlEventReturnValidator,
  validateAndNormalizeAttempt,
  validateAndNormalizeEvent,
  formatAttemptForClient,
  formatEventForClient,
} from "./telemetryValidators";

const CLEAR_BATCH_SIZE = 2048;
const MAX_RECORD_EVENTS_BATCH = 100;

async function deleteTelemetryChunkForUser(
  ctx: MutationCtx,
  userId: Id<"users">,
  cutoffCreationTimeMs?: number
): Promise<boolean> {
  const attempts = await ctx.db
    .query("session_attempts")
    .withIndex("by_user_attempt", (q) => q.eq("userId", userId))
    .take(CLEAR_BATCH_SIZE);

  let deletedAttempts = 0;
  for (const attempt of attempts) {
    if (cutoffCreationTimeMs !== undefined && attempt._creationTime > cutoffCreationTimeMs) {
      continue;
    }
    await ctx.db.delete(attempt._id);
    deletedAttempts += 1;
  }

  const events = await ctx.db
    .query("ml_events")
    .withIndex("by_user_event", (q) => q.eq("userId", userId))
    .take(CLEAR_BATCH_SIZE);

  let deletedEvents = 0;
  for (const event of events) {
    if (cutoffCreationTimeMs !== undefined && event._creationTime > cutoffCreationTimeMs) {
      continue;
    }
    await ctx.db.delete(event._id);
    deletedEvents += 1;
  }

  return (
    (attempts.length === CLEAR_BATCH_SIZE && deletedAttempts > 0) ||
    (events.length === CLEAR_BATCH_SIZE && deletedEvents > 0)
  );
}

export const upsertAttempt = mutation({
  args: sessionAttemptInputFields,
  returns: sessionAttemptReturnValidator,
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, true);
    const parsed = validateAndNormalizeAttempt(args);
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    const normalized = parsed.value;

    const existing = await ctx.db
      .query("session_attempts")
      .withIndex("by_user_attempt", (q) =>
        q.eq("userId", user._id).eq("attemptId", normalized.attemptId)
      )
      .first();

    if (existing) {
      const existingIsFinalized = existing.status !== "in_progress";
      const incomingIsInProgress = normalized.status === "in_progress";
      const incomingIsOlder = normalized.updatedAtMs < existing.updatedAtMs;
      const upgradesStaleToExplicit =
        existing.status === "abandoned_stale" &&
        !incomingIsInProgress &&
        normalized.status !== "abandoned_stale";
      const lockedByServerFinalization =
        existingIsFinalized &&
        existing.source === "server_scheduled" &&
        normalized.source === "client" &&
        !upgradesStaleToExplicit;
      const completedProtected =
        existing.status === "completed" && normalized.status !== "completed";
      const staleCannotOverwriteFinalized =
        existingIsFinalized && normalized.status === "abandoned_stale";

      if (
        lockedByServerFinalization ||
        (existingIsFinalized && incomingIsInProgress) ||
        completedProtected ||
        staleCannotOverwriteFinalized ||
        (existingIsFinalized && !upgradesStaleToExplicit && incomingIsOlder) ||
        (!existingIsFinalized && incomingIsInProgress && incomingIsOlder)
      ) {
        return formatAttemptForClient(existing);
      }

      const isSynthesizedSecondaryFinalization =
        !incomingIsInProgress &&
        ((existing.pauseCount > 0 && normalized.pauseCount === 0) ||
          (Boolean(existing.startedAt) &&
            existing.startedAt !== normalized.startedAt));

      let mergedAttempt = normalized;
      if (isSynthesizedSecondaryFinalization) {
        const resolvedInitialTagId = existing.initialTagId ?? normalized.initialTagId;
        const resolvedTagId = normalized.tagId ?? existing.tagId;
        mergedAttempt = {
          ...normalized,
          startedAt: existing.startedAt ?? normalized.startedAt,
          utcOffsetMinutes: existing.utcOffsetMinutes,
          ianaTimezone: existing.ianaTimezone ?? normalized.ianaTimezone,
          localDate: existing.localDate,
          localHour: existing.localHour,
          localMinuteOfDay: existing.localMinuteOfDay,
          localDayOfWeek: existing.localDayOfWeek,
          cycleIndex: existing.cycleIndex,
          longBreakInterval: existing.longBreakInterval,
          autoStarted: existing.autoStarted || normalized.autoStarted,
          initialTagId: resolvedInitialTagId,
          tagId: resolvedTagId,
          tagChangedMidRun: Boolean(
            existing.tagChangedMidRun ||
              normalized.tagChangedMidRun ||
              resolvedInitialTagId !== resolvedTagId
          ),
          pauseCount: Math.max(existing.pauseCount, normalized.pauseCount),
          totalPausedSeconds: Math.max(
            existing.totalPausedSeconds,
            normalized.totalPausedSeconds
          ),
          pauseIntervals:
            normalized.pauseIntervals.length >= existing.pauseIntervals.length
              ? normalized.pauseIntervals
              : existing.pauseIntervals,
          timeSincePreviousAttemptSeconds:
            existing.timeSincePreviousAttemptSeconds ??
            normalized.timeSincePreviousAttemptSeconds,
          previousAttemptType:
            existing.previousAttemptType ?? normalized.previousAttemptType,
          previousAttemptOutcome:
            existing.previousAttemptOutcome ?? normalized.previousAttemptOutcome,
          workSessionsCompletedToday: existing.workSessionsCompletedToday,
          workActiveSecondsToday: existing.workActiveSecondsToday,
          skipsToday: existing.skipsToday,
          coffeeCupsTodayAtStart: existing.coffeeCupsTodayAtStart,
          minutesSinceLastCoffeeAtStart:
            existing.minutesSinceLastCoffeeAtStart ??
            normalized.minutesSinceLastCoffeeAtStart,
          coffeeLoggedDuringRun: Math.max(
            existing.coffeeLoggedDuringRun,
            normalized.coffeeLoggedDuringRun
          ),
          dailyGoalMinutes: existing.dailyGoalMinutes,
          settingsSnapshot: existing.settingsSnapshot,
          deviceClass: existing.deviceClass,
          tabBackgroundedCount: Math.max(
            existing.tabBackgroundedCount,
            normalized.tabBackgroundedCount
          ),
        };
      }

      await ctx.db.replace(existing._id, {
        userId: user._id,
        ...mergedAttempt,
      });
      return formatAttemptForClient(mergedAttempt);
    }

    await ctx.db.insert("session_attempts", {
      userId: user._id,
      ...normalized,
    });
    return formatAttemptForClient(normalized);
  },
});

export const recordEvents = mutation({
  args: {
    events: v.array(mlEventInputValidator),
  },
  returns: v.object({
    insertedCount: v.number(),
    skippedCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, true);
    if (args.events.length > MAX_RECORD_EVENTS_BATCH) {
      throw new Error(`Cannot record more than ${MAX_RECORD_EVENTS_BATCH} events per call.`);
    }

    const seenEventIds = new Set<string>();
    let insertedCount = 0;
    let skippedCount = 0;

    for (const rawEvent of args.events) {
      const parsed = validateAndNormalizeEvent(rawEvent);
      if (!parsed.ok) {
        throw new Error(parsed.error);
      }
      const normalized = parsed.value;

      if (seenEventIds.has(normalized.eventId)) {
        skippedCount += 1;
        continue;
      }
      seenEventIds.add(normalized.eventId);

      const existing = await ctx.db
        .query("ml_events")
        .withIndex("by_user_event", (q) =>
          q.eq("userId", user._id).eq("eventId", normalized.eventId)
        )
        .first();

      if (existing) {
        skippedCount += 1;
        continue;
      }

      await ctx.db.insert("ml_events", {
        userId: user._id,
        ...normalized,
      });
      insertedCount += 1;
    }

    return { insertedCount, skippedCount };
  },
});

export const discardAttempt = mutation({
  args: {
    attemptId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (!ID_REGEX.test(args.attemptId)) {
      throw new Error("Invalid attemptId format.");
    }

    const existing = await ctx.db
      .query("session_attempts")
      .withIndex("by_user_attempt", (q) =>
        q.eq("userId", user._id).eq("attemptId", args.attemptId)
      )
      .first();

    // Never discard an already-finalized attempt
    if (existing && existing.status !== "in_progress") {
      return false;
    }

    if (existing) {
      await ctx.db.delete(existing._id);
    }

    // Clean up any recent tag_changed events (or unlink coffee_logged) within a bounded scan
    const recentEvents = await ctx.db
      .query("ml_events")
      .withIndex("by_user_timestamp", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(200);

    for (const evt of recentEvents) {
      if (evt.attemptId !== args.attemptId) continue;
      if (
        evt.eventType === "session_started" ||
        evt.eventType === "session_paused" ||
        evt.eventType === "session_resumed" ||
        evt.eventType === "tag_changed"
      ) {
        await ctx.db.delete(evt._id);
      } else {
        await ctx.db.patch(evt._id, { attemptId: undefined });
      }
    }

    return true;
  },
});

export const listAttempts = query({
  args: {
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.union(v.array(sessionAttemptReturnValidator), v.null()),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return null;

    const rawLimit = args.limit !== undefined && Number.isFinite(args.limit) ? args.limit : 2000;
    const safeLimit = Math.min(Math.max(1, Math.floor(rawLimit)), 5000);

    if (args.startDate || args.endDate) {
      const start = args.startDate ? args.startDate.slice(0, 10) : "0000-01-01";
      const end = args.endDate ? args.endDate.slice(0, 10) : "9999-12-31";
      const attempts = await ctx.db
        .query("session_attempts")
        .withIndex("by_user_local_date", (q) =>
          q.eq("userId", user._id).gte("localDate", start).lte("localDate", end)
        )
        .order("desc")
        .take(safeLimit);
      return attempts.map(formatAttemptForClient);
    }

    const attempts = await ctx.db
      .query("session_attempts")
      .withIndex("by_user_ended", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(safeLimit);
    return attempts.map(formatAttemptForClient);
  },
});

export const listEvents = query({
  args: {
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.union(v.array(mlEventReturnValidator), v.null()),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return null;

    const rawLimit = args.limit !== undefined && Number.isFinite(args.limit) ? args.limit : 2000;
    const safeLimit = Math.min(Math.max(1, Math.floor(rawLimit)), 5000);

    if (args.startDate || args.endDate) {
      const start = args.startDate ? args.startDate.slice(0, 10) : "0000-01-01";
      const end = args.endDate ? args.endDate.slice(0, 10) : "9999-12-31";
      const events = await ctx.db
        .query("ml_events")
        .withIndex("by_user_local_date", (q) =>
          q.eq("userId", user._id).gte("localDate", start).lte("localDate", end)
        )
        .order("desc")
        .take(safeLimit);
      return events.map(formatEventForClient);
    }

    const events = await ctx.db
      .query("ml_events")
      .withIndex("by_user_timestamp", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(safeLimit);
    return events.map(formatEventForClient);
  },
});

export const clear = mutation({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const cutoffCreationTimeMs = Date.now();
    const hasMore = await deleteTelemetryChunkForUser(ctx, user._id, cutoffCreationTimeMs);
    if (hasMore) {
      await ctx.scheduler.runAfter(0, internal.telemetry.clearUserChunk, {
        userId: user._id,
        cutoffCreationTimeMs,
      });
    }
    return true;
  },
});

export const clearUserChunk = internalMutation({
  args: {
    userId: v.id("users"),
    cutoffCreationTimeMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const hasMore = await deleteTelemetryChunkForUser(
      ctx,
      args.userId,
      args.cutoffCreationTimeMs
    );
    if (hasMore) {
      await ctx.scheduler.runAfter(0, internal.telemetry.clearUserChunk, {
        userId: args.userId,
        cutoffCreationTimeMs: args.cutoffCreationTimeMs,
      });
    }
    return null;
  },
});

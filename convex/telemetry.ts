import { v } from "convex/values";
import { query, mutation, internalMutation, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { requireUser, getAuthenticatedUser } from "./authHelper";
import {
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
  userId: Id<"users">
): Promise<boolean> {
  const attempts = await ctx.db
    .query("session_attempts")
    .withIndex("by_user_attempt", (q) => q.eq("userId", userId))
    .take(CLEAR_BATCH_SIZE);

  for (const attempt of attempts) {
    await ctx.db.delete(attempt._id);
  }

  const events = await ctx.db
    .query("ml_events")
    .withIndex("by_user_event", (q) => q.eq("userId", userId))
    .take(CLEAR_BATCH_SIZE);

  for (const event of events) {
    await ctx.db.delete(event._id);
  }

  return attempts.length === CLEAR_BATCH_SIZE || events.length === CLEAR_BATCH_SIZE;
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
      const lockedByServerFinalization =
        existingIsFinalized &&
        existing.source === "server_scheduled" &&
        normalized.source === "client";

      if (
        lockedByServerFinalization ||
        (existingIsFinalized && (incomingIsInProgress || incomingIsOlder)) ||
        (!existingIsFinalized && incomingIsInProgress && incomingIsOlder)
      ) {
        return formatAttemptForClient(existing);
      }

      await ctx.db.replace(existing._id, {
        userId: user._id,
        ...normalized,
      });
      return formatAttemptForClient(normalized);
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

      // Deduplicate against server-emitted completion event for the same attemptId
      if (normalized.eventType === "session_completed" && normalized.attemptId) {
        const srvCompEvent = await ctx.db
          .query("ml_events")
          .withIndex("by_user_event", (q) =>
            q.eq("userId", user._id).eq("eventId", `srv-comp-${normalized.attemptId}`)
          )
          .first();
        if (srvCompEvent) {
          skippedCount += 1;
          continue;
        }
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
    const hasMore = await deleteTelemetryChunkForUser(ctx, user._id);
    if (hasMore) {
      await ctx.scheduler.runAfter(0, internal.telemetry.clearUserChunk, {
        userId: user._id,
      });
    }
    return true;
  },
});

export const clearUserChunk = internalMutation({
  args: {
    userId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const hasMore = await deleteTelemetryChunkForUser(ctx, args.userId);
    if (hasMore) {
      await ctx.scheduler.runAfter(0, internal.telemetry.clearUserChunk, {
        userId: args.userId,
      });
    }
    return null;
  },
});

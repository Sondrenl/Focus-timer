import { v } from "convex/values";
import { query, mutation, internalMutation, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { requireUser, getAuthenticatedUser } from "./authHelper";
import {
  sessionAttemptInputFields,
  sessionAttemptReturnValidator,
  validateAndNormalizeAttempt,
  formatAttemptForClient,
} from "./telemetryValidators";

const CLEAR_BATCH_SIZE = 2048;

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

  return attempts.length === CLEAR_BATCH_SIZE && deletedAttempts > 0;
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
    // Public client upserts are always client-originated; only internal server mutations emit server_scheduled.
    const normalized = { ...parsed.value, source: "client" as const };

    const existing = await ctx.db
      .query("session_attempts")
      .withIndex("by_user_attempt", (q) =>
        q.eq("userId", user._id).eq("attemptId", normalized.attemptId)
      )
      .first();

    if (existing) {
      const upgradesStale =
        existing.status === "abandoned_stale" && normalized.status !== "abandoned_stale";
      const sameTerminalStatus =
        existing.status === normalized.status && existing.status !== "in_progress";
      const incomingIsRicher =
        (existing.source === "server_scheduled" && normalized.source === "client") ||
        normalized.pauseCount > existing.pauseCount ||
        normalized.pauseIntervals.length > existing.pauseIntervals.length ||
        normalized.tabBackgroundedCount > existing.tabBackgroundedCount ||
        (normalized.tagChangedMidRun && !existing.tagChangedMidRun) ||
        (normalized.autoStarted && !existing.autoStarted);

      if (
        (existing.status === "completed" && normalized.status !== "completed") ||
        (existing.status !== "in_progress" && normalized.status === "abandoned_stale") ||
        (sameTerminalStatus && !incomingIsRicher) ||
        (!upgradesStale && !sameTerminalStatus && normalized.updatedAtMs < existing.updatedAtMs)
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

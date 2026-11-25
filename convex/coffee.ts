import { v } from "convex/values";
import { query, mutation, internalMutation, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { requireUser, getAuthenticatedUser } from "./authHelper";
import {
  assertValidTagId,
  resolveExistingUserTagId,
  MAX_FUTURE_TIMESTAMP_SKEW_MS,
} from "./timerHelpers";

const CLEAR_BATCH_SIZE = 2048;

async function deleteCoffeeChunkForUser(
  ctx: MutationCtx,
  userId: Id<"users">,
  cutoffCreationTimeMs?: number
): Promise<boolean> {
  const cups = await ctx.db
    .query("coffee_cups")
    .withIndex("by_user_date", (q) => q.eq("userId", userId))
    .take(CLEAR_BATCH_SIZE);

  let deletedCount = 0;
  for (const cup of cups) {
    if (cutoffCreationTimeMs !== undefined && cup._creationTime > cutoffCreationTimeMs) {
      continue;
    }
    await ctx.db.delete(cup._id);
    deletedCount += 1;
  }

  return cups.length === CLEAR_BATCH_SIZE && deletedCount > 0;
}

/**
 * Returns coffee cups. Optionally filters by date (e.g. today "YYYY-MM-DD")
 * or returns recent cups up to an optional limit in chronological ascending order.
 * Returns null if user is not authenticated yet.
 */
export const list = query({
  args: {
    date: v.optional(v.string()), // Optional filter by "YYYY-MM-DD"
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return null;

    const rawLimit = args.limit !== undefined && Number.isFinite(args.limit) ? args.limit : 2000;
    const safeLimit = Math.min(Math.max(1, Math.floor(rawLimit)), 5000);
    let cups;
    if (args.date) {
      cups = await ctx.db
        .query("coffee_cups")
        .withIndex("by_user_date", (q) =>
          q.eq("userId", user._id).eq("date", args.date!)
        )
        .take(100);
    } else {
      const descCups = await ctx.db
        .query("coffee_cups")
        .withIndex("by_user_date", (q) => q.eq("userId", user._id))
        .order("desc")
        .take(safeLimit);
      cups = descCups.reverse();
    }

    cups.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    return cups.map((c) => ({
      id: c._id,
      date: c.date,
      tagId: c.tagId ?? null,
      createdAt: c.createdAt,
    }));
  },
});

export const addCup = mutation({
  args: {
    date: v.string(), // "YYYY-MM-DD"
    tagId: v.optional(v.union(v.string(), v.null())),
    createdAt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, true);
    const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
    if (!DATE_REGEX.test(args.date)) {
      throw new Error("Invalid date format: must be YYYY-MM-DD.");
    }

    assertValidTagId(args.tagId);

    const cupsToday = await ctx.db
      .query("coffee_cups")
      .withIndex("by_user_date", (q) => q.eq("userId", user._id).eq("date", args.date))
      .take(50);
    if (cupsToday.length >= 50) {
      throw new Error("Maximum limit of 50 coffee cups per day reached.");
    }

    const nowMs = Date.now();
    const parsedCreatedMs =
      args.createdAt && args.createdAt.length <= 64
        ? new Date(args.createdAt).getTime()
        : NaN;
    if (!Number.isNaN(parsedCreatedMs) && parsedCreatedMs > nowMs + MAX_FUTURE_TIMESTAMP_SKEW_MS) {
      throw new Error("createdAt timestamp cannot be in the future.");
    }
    const createdAt = !Number.isNaN(parsedCreatedMs)
      ? new Date(parsedCreatedMs).toISOString()
      : new Date(nowMs).toISOString();
    const sanitizedTagId = resolveExistingUserTagId(user, args.tagId);

    const cupId = await ctx.db.insert("coffee_cups", {
      userId: user._id,
      date: args.date,
      tagId: sanitizedTagId,
      createdAt,
    });

    return {
      id: cupId,
      date: args.date,
      tagId: sanitizedTagId ?? null,
      createdAt,
    };
  },
});

export const removeCup = mutation({
  args: {
    id: v.optional(v.string()),
    date: v.optional(v.string()),
    tagId: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    // 1. If a valid Convex coffee_cups ID is provided, strictly resolve it and never fall through
    // to date/tag matching if the target cup was already deleted on another device.
    if (args.id) {
      const normalizedId = ctx.db.normalizeId("coffee_cups", args.id);
      if (normalizedId) {
        const cup = await ctx.db.get(normalizedId);
        if (cup && cup.userId === user._id) {
          await ctx.db.delete(cup._id);
          return true;
        }
        return false;
      }
    }

    // 2. Fallback to deleting latest matching cup for date/tag (only for local/non-Convex IDs)
    const date = args.date ?? new Date().toISOString().slice(0, 10);
    const cups = await ctx.db
      .query("coffee_cups")
      .withIndex("by_user_date", (q) => q.eq("userId", user._id).eq("date", date))
      .take(100);

    cups.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    let target = null;
    for (let i = cups.length - 1; i >= 0; i--) {
      const c = cups[i];
      if (args.tagId !== undefined) {
        if ((c.tagId ?? null) === (args.tagId ?? null)) {
          target = c;
          break;
        }
      } else {
        if (!c.tagId) {
          target = c;
          break;
        }
      }
    }

    // Strict tag scoping: only fall back to deleting the latest cup if no specific tag was requested
    if (!target && args.tagId === undefined && cups.length > 0) {
      target = cups[cups.length - 1];
    }

    if (target) {
      await ctx.db.delete(target._id);
      return true;
    }

    return false;
  },
});

export const clear = mutation({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const cutoffCreationTimeMs = Date.now();
    const hasMore = await deleteCoffeeChunkForUser(ctx, user._id, cutoffCreationTimeMs);
    if (hasMore) {
      await ctx.scheduler.runAfter(0, internal.coffee.clearChunkInternal, {
        userId: user._id,
        cutoffCreationTimeMs,
      });
    }
    return true;
  },
});

export const clearChunkInternal = internalMutation({
  args: {
    userId: v.id("users"),
    cutoffCreationTimeMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const hasMore = await deleteCoffeeChunkForUser(
      ctx,
      args.userId,
      args.cutoffCreationTimeMs
    );
    if (hasMore) {
      await ctx.scheduler.runAfter(0, internal.coffee.clearChunkInternal, {
        userId: args.userId,
        cutoffCreationTimeMs: args.cutoffCreationTimeMs,
      });
    }
    return null;
  },
});

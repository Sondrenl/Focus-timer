import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireUser, getAuthenticatedUser } from "./authHelper";

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

    let cups;
    if (args.date) {
      cups = await ctx.db
        .query("coffee_cups")
        .withIndex("by_user_date", (q) =>
          q.eq("userId", user._id).eq("date", args.date!)
        )
        .collect();
    } else {
      const limit = args.limit ?? 2000;
      const descCups = await ctx.db
        .query("coffee_cups")
        .withIndex("by_user_date", (q) => q.eq("userId", user._id))
        .order("desc")
        .take(limit);
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

    const cupsToday = await ctx.db
      .query("coffee_cups")
      .withIndex("by_user_date", (q) => q.eq("userId", user._id).eq("date", args.date))
      .collect();
    if (cupsToday.length >= 50) {
      throw new Error("Maximum limit of 50 coffee cups per day reached.");
    }

    const now = args.createdAt ?? new Date().toISOString();
    const sanitizedTagId = args.tagId || undefined;

    const cupId = await ctx.db.insert("coffee_cups", {
      userId: user._id,
      date: args.date,
      tagId: sanitizedTagId,
      createdAt: now,
    });

    return {
      id: cupId,
      date: args.date,
      tagId: sanitizedTagId ?? null,
      createdAt: now,
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

    // 1. If an ID is provided, try to find and delete by ID
    if (args.id) {
      try {
        const cup = await ctx.db.get(args.id as any);
        if (cup && "userId" in cup && cup.userId === user._id) {
          await ctx.db.delete(cup._id);
          return true;
        }
      } catch {
        // Not a valid Convex ID format, fall through to date/tag matching
      }
    }

    // 2. Fallback to deleting latest matching cup for date/tag
    const date = args.date ?? new Date().toISOString().slice(0, 10);
    const cups = await ctx.db
      .query("coffee_cups")
      .withIndex("by_user_date", (q) => q.eq("userId", user._id).eq("date", date))
      .collect();

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
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const cups = await ctx.db
      .query("coffee_cups")
      .withIndex("by_user_date", (q) => q.eq("userId", user._id))
      .collect();

    for (const cup of cups) {
      await ctx.db.delete(cup._id);
    }

    return true;
  },
});

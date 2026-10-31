import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireUser, getAuthenticatedUser } from "./authHelper";

export const listToday = query({
  args: { date: v.string() }, // YYYY-MM-DD
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return [];

    const cups = await ctx.db
      .query("coffee_cups")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", user._id).eq("date", args.date)
      )
      .collect();

    return cups.map((c) => ({
      id: c._id,
      date: c.date,
      tagId: c.tagId ?? null,
      createdAt: c.createdAt,
    }));
  },
});

export const listAll = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return [];

    const limit = args.limit ?? 500;
    const cups = await ctx.db
      .query("coffee_cups")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(limit);

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
    date: v.string(), // YYYY-MM-DD
    tagId: v.optional(v.string()),
    createdAt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, true);
    const now = args.createdAt ?? new Date().toISOString();

    const cupId = await ctx.db.insert("coffee_cups", {
      userId: user._id,
      date: args.date,
      tagId: args.tagId,
      createdAt: now,
      timestamp: Date.now(),
    });

    return {
      id: cupId,
      date: args.date,
      tagId: args.tagId ?? null,
      createdAt: now,
    };
  },
});

export const removeCup = mutation({
  args: { id: v.id("coffee_cups") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const cup = await ctx.db.get(args.id);
    if (!cup || cup.userId !== user._id) {
      throw new Error("Coffee cup not found or unauthorized");
    }

    await ctx.db.delete(args.id);
    return true;
  },
});

export const clear = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const cups = await ctx.db
      .query("coffee_cups")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    for (const cup of cups) {
      await ctx.db.delete(cup._id);
    }

    return true;
  },
});

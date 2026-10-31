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

    // 1. Record raw cup log
    const cupId = await ctx.db.insert("coffee_cups", {
      userId: user._id,
      date: args.date,
      tagId: args.tagId,
      createdAt: now,
      timestamp: Date.now(),
    });

    // 2. Atomically maintain daily summary aggregate
    const daily = await ctx.db
      .query("daily_stats")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", user._id).eq("date", args.date)
      )
      .first();

    if (daily) {
      const tagCoffee = { ...(daily.tagCoffee ?? {}) };
      if (args.tagId) {
        tagCoffee[args.tagId] = (tagCoffee[args.tagId] ?? 0) + 1;
      }
      await ctx.db.patch(daily._id, {
        coffeeCount: daily.coffeeCount + 1,
        tagCoffee,
      });
    } else {
      const tagCoffee: Record<string, number> = {};
      if (args.tagId) {
        tagCoffee[args.tagId] = 1;
      }
      await ctx.db.insert("daily_stats", {
        userId: user._id,
        date: args.date,
        workSeconds: 0,
        workSessionsCount: 0,
        shortBreakSeconds: 0,
        longBreakSeconds: 0,
        coffeeCount: 1,
        tagSeconds: {},
        tagCoffee,
      });
    }

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

    // 1. Remove cup document
    await ctx.db.delete(args.id);

    // 2. Adjust daily stats
    const daily = await ctx.db
      .query("daily_stats")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", user._id).eq("date", cup.date)
      )
      .first();

    if (daily) {
      const tagCoffee = { ...(daily.tagCoffee ?? {}) };
      if (cup.tagId && tagCoffee[cup.tagId]) {
        tagCoffee[cup.tagId] = Math.max(0, tagCoffee[cup.tagId] - 1);
      }
      await ctx.db.patch(daily._id, {
        coffeeCount: Math.max(0, daily.coffeeCount - 1),
        tagCoffee,
      });
    }

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

    const allDaily = await ctx.db
      .query("daily_stats")
      .withIndex("by_user_date", (q) => q.eq("userId", user._id))
      .collect();

    for (const d of allDaily) {
      await ctx.db.patch(d._id, {
        coffeeCount: 0,
        tagCoffee: {},
      });
    }

    return true;
  },
});

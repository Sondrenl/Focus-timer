import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireUser, getAuthenticatedUser } from "./authHelper";

export const listRecent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return [];

    const limit = args.limit ?? 200;
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(limit);

    return sessions.map((s) => ({
      id: s._id,
      tagId: s.tagId ?? null,
      sessionType: s.sessionType,
      durationSeconds: s.durationSeconds,
      completedAt: s.completedAt,
      date: s.date,
    }));
  },
});

export const listByDateRange = query({
  args: {
    startDate: v.string(), // "YYYY-MM-DD"
    endDate: v.string(),   // "YYYY-MM-DD"
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return [];

    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user_date", (q) =>
        q
          .eq("userId", user._id)
          .gte("date", args.startDate)
          .lte("date", args.endDate)
      )
      .collect();

    return sessions.map((s) => ({
      id: s._id,
      tagId: s.tagId ?? null,
      sessionType: s.sessionType,
      durationSeconds: s.durationSeconds,
      completedAt: s.completedAt,
      date: s.date,
    }));
  },
});

export const record = mutation({
  args: {
    tagId: v.optional(v.string()),
    sessionType: v.union(
      v.literal("WORK"),
      v.literal("SHORT_BREAK"),
      v.literal("LONG_BREAK")
    ),
    durationSeconds: v.number(),
    completedAt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, true);
    const completedAt = args.completedAt ?? new Date().toISOString();
    const date = completedAt.slice(0, 10); // "YYYY-MM-DD"

    // 1. Insert session record
    const sessionId = await ctx.db.insert("sessions", {
      userId: user._id,
      tagId: args.tagId,
      sessionType: args.sessionType,
      durationSeconds: args.durationSeconds,
      completedAt,
      date,
    });

    // 2. Atomically maintain daily stats aggregate
    const daily = await ctx.db
      .query("daily_stats")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", user._id).eq("date", date)
      )
      .first();

    const isWork = args.sessionType === "WORK";
    const isShortBreak = args.sessionType === "SHORT_BREAK";
    const isLongBreak = args.sessionType === "LONG_BREAK";

    if (daily) {
      const tagSeconds = { ...(daily.tagSeconds ?? {}) };
      if (isWork && args.tagId) {
        tagSeconds[args.tagId] = (tagSeconds[args.tagId] ?? 0) + args.durationSeconds;
      }

      await ctx.db.patch(daily._id, {
        workSeconds: daily.workSeconds + (isWork ? args.durationSeconds : 0),
        workSessionsCount: daily.workSessionsCount + (isWork ? 1 : 0),
        shortBreakSeconds: daily.shortBreakSeconds + (isShortBreak ? args.durationSeconds : 0),
        longBreakSeconds: daily.longBreakSeconds + (isLongBreak ? args.durationSeconds : 0),
        tagSeconds,
      });
    } else {
      const tagSeconds: Record<string, number> = {};
      if (isWork && args.tagId) {
        tagSeconds[args.tagId] = args.durationSeconds;
      }

      await ctx.db.insert("daily_stats", {
        userId: user._id,
        date,
        workSeconds: isWork ? args.durationSeconds : 0,
        workSessionsCount: isWork ? 1 : 0,
        shortBreakSeconds: isShortBreak ? args.durationSeconds : 0,
        longBreakSeconds: isLongBreak ? args.durationSeconds : 0,
        coffeeCount: 0,
        tagSeconds,
        tagCoffee: {},
      });
    }

    return {
      id: sessionId,
      tagId: args.tagId ?? null,
      sessionType: args.sessionType,
      durationSeconds: args.durationSeconds,
      completedAt,
      date,
    };
  },
});

export const getDailyStatsRange = query({
  args: {
    startDate: v.string(), // "YYYY-MM-DD"
    endDate: v.string(),   // "YYYY-MM-DD"
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return [];

    return await ctx.db
      .query("daily_stats")
      .withIndex("by_user_date", (q) =>
        q
          .eq("userId", user._id)
          .gte("date", args.startDate)
          .lte("date", args.endDate)
      )
      .collect();
  },
});

export const clear = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    for (const session of sessions) {
      await ctx.db.delete(session._id);
    }

    const allDaily = await ctx.db
      .query("daily_stats")
      .withIndex("by_user_date", (q) => q.eq("userId", user._id))
      .collect();

    for (const d of allDaily) {
      await ctx.db.patch(d._id, {
        workSeconds: 0,
        workSessionsCount: 0,
        shortBreakSeconds: 0,
        longBreakSeconds: 0,
        tagSeconds: {},
      });
    }

    return true;
  },
});

import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireUser, getAuthenticatedUser } from "./authHelper";

export const listRecent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return [];

    const limit = args.limit ?? 500;
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
    const now = args.completedAt ?? new Date().toISOString();

    const sessionId = await ctx.db.insert("sessions", {
      userId: user._id,
      tagId: args.tagId,
      sessionType: args.sessionType,
      durationSeconds: args.durationSeconds,
      completedAt: now,
    });

    return {
      id: sessionId,
      tagId: args.tagId ?? null,
      sessionType: args.sessionType,
      durationSeconds: args.durationSeconds,
      completedAt: now,
    };
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
    return true;
  },
});

export const getStatsSummary = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) {
      return {
        totalWorkMinutes: 0,
        totalSessions: 0,
        todayWorkMinutes: 0,
        todayCoffeeCount: 0,
      };
    }

    const todayDateString = new Date().toISOString().slice(0, 10);

    const [allSessions, todayCups] = await Promise.all([
      ctx.db
        .query("sessions")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect(),
      ctx.db
        .query("coffee_cups")
        .withIndex("by_user_date", (q) =>
          q.eq("userId", user._id).eq("date", todayDateString)
        )
        .collect(),
    ]);

    let totalWorkSeconds = 0;
    let todayWorkSeconds = 0;
    let workSessionCount = 0;

    for (const s of allSessions) {
      if (s.sessionType === "WORK") {
        totalWorkSeconds += s.durationSeconds;
        workSessionCount++;
        if (s.completedAt.startsWith(todayDateString)) {
          todayWorkSeconds += s.durationSeconds;
        }
      }
    }

    return {
      totalWorkMinutes: Math.round(totalWorkSeconds / 60),
      totalSessions: workSessionCount,
      todayWorkMinutes: Math.round(todayWorkSeconds / 60),
      todayCoffeeCount: todayCups.length,
    };
  },
});

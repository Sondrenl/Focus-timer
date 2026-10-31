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

    const sessionId = await ctx.db.insert("sessions", {
      userId: user._id,
      tagId: args.tagId,
      sessionType: args.sessionType,
      durationSeconds: args.durationSeconds,
      completedAt,
      date,
    });

    return {
      id: sessionId,
      tagId: args.tagId ?? null,
      sessionType: args.sessionType,
      durationSeconds: args.durationSeconds,
      completedAt,
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

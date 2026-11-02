import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireUser, getAuthenticatedUser } from "./authHelper";

interface SessionData {
  tagId?: string | null;
  sessionType: "WORK" | "SHORT_BREAK" | "LONG_BREAK";
  durationSeconds: number;
  completedAt: string;
}

function formatSessionRecord(id: string, s: SessionData) {
  return {
    id,
    tagId: s.tagId ?? null,
    sessionType: s.sessionType,
    durationSeconds: s.durationSeconds,
    completedAt: s.completedAt,
  };
}

/**
 * Returns completed focus/break sessions.
 * Supports date-range filtering or returning recent sessions up to a limit.
 */
export const list = query({
  args: {
    startDate: v.optional(v.string()), // ISO string or "YYYY-MM-DD"
    endDate: v.optional(v.string()),   // ISO string or "YYYY-MM-DD"
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return [];

    let sessions;
    if (args.startDate || args.endDate) {
      const start = args.startDate ?? "1970-01-01";
      const end = args.endDate ? (args.endDate.length === 10 ? `${args.endDate}T23:59:59.999Z` : args.endDate) : "9999-12-31";

      sessions = await ctx.db
        .query("sessions")
        .withIndex("by_user_completed", (q) =>
          q
            .eq("userId", user._id)
            .gte("completedAt", start)
            .lte("completedAt", end)
        )
        .collect();
    } else {
      const limit = args.limit ?? 500;
      const descSessions = await ctx.db
        .query("sessions")
        .withIndex("by_user_completed", (q) => q.eq("userId", user._id))
        .order("desc")
        .take(limit);
      sessions = descSessions.reverse();
    }

    return sessions.map((s) => formatSessionRecord(s._id, s));
  },
});

export const record = mutation({
  args: {
    tagId: v.optional(v.union(v.string(), v.null())),
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
    const sanitizedTagId = args.tagId || undefined;

    const completedAtMs = new Date(completedAt).getTime();
    const recent = await ctx.db
      .query("sessions")
      .withIndex("by_user_completed", (q) =>
        q
          .eq("userId", user._id)
          .gte("completedAt", new Date(completedAtMs - 45000).toISOString())
          .lte("completedAt", new Date(completedAtMs + 45000).toISOString())
      )
      .collect();

    const duplicate = recent.find((s) => s.sessionType === args.sessionType);
    if (duplicate) {
      return formatSessionRecord(duplicate._id, duplicate);
    }

    const sessionId = await ctx.db.insert("sessions", {
      userId: user._id,
      tagId: sanitizedTagId,
      sessionType: args.sessionType,
      durationSeconds: args.durationSeconds,
      completedAt,
    });

    return formatSessionRecord(sessionId, {
      tagId: sanitizedTagId,
      sessionType: args.sessionType,
      durationSeconds: args.durationSeconds,
      completedAt,
    });
  },
});

export const clear = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user_completed", (q) => q.eq("userId", user._id))
      .collect();

    for (const session of sessions) {
      await ctx.db.delete(session._id);
    }

    return true;
  },
});

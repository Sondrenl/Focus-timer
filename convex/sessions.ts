import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireUser, getAuthenticatedUser } from "./authHelper";
import {
  assertValidTagId,
  MAX_FUTURE_TIMESTAMP_SKEW_MS,
  recordCompletedSessionIfNotDuplicate,
} from "./timerHelpers";

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
 * Returns null if user is not authenticated yet.
 */
export const list = query({
  args: {
    startDate: v.optional(v.string()), // ISO string or "YYYY-MM-DD"
    endDate: v.optional(v.string()),   // ISO string or "YYYY-MM-DD"
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return null;

    const safeLimit = Math.min(Math.max(1, args.limit ?? 2000), 5000);
    let sessions;
    if (args.startDate || args.endDate) {
      const start = args.startDate
        ? args.startDate.length === 10
          ? `${args.startDate}T00:00:00.000Z`
          : args.startDate
        : "1970-01-01T00:00:00.000Z";
      const end = args.endDate
        ? args.endDate.length === 10
          ? `${args.endDate}T23:59:59.999Z`
          : args.endDate
        : "9999-12-31T23:59:59.999Z";

      sessions = await ctx.db
        .query("sessions")
        .withIndex("by_user_completed", (q) =>
          q
            .eq("userId", user._id)
            .gte("completedAt", start)
            .lte("completedAt", end)
        )
        .take(safeLimit);
    } else {
      const descSessions = await ctx.db
        .query("sessions")
        .withIndex("by_user_completed", (q) => q.eq("userId", user._id))
        .order("desc")
        .take(safeLimit);
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
    if (!Number.isFinite(args.durationSeconds) || args.durationSeconds <= 0 || args.durationSeconds > 86400 * 7) {
      throw new Error("Invalid durationSeconds: must be a positive finite number up to 7 days.");
    }

    assertValidTagId(args.tagId);

    const nowMs = Date.now();
    const parsedMs = args.completedAt ? new Date(args.completedAt).getTime() : NaN;
    if (!Number.isNaN(parsedMs) && parsedMs > nowMs + MAX_FUTURE_TIMESTAMP_SKEW_MS) {
      throw new Error("completedAt timestamp cannot be in the future.");
    }
    const completedAtMs = !Number.isNaN(parsedMs) ? parsedMs : nowMs;
    const sanitizedTagId = args.tagId || undefined;

    const recorded = await recordCompletedSessionIfNotDuplicate(ctx, {
      userId: user._id,
      tagId: sanitizedTagId,
      sessionType: args.sessionType,
      durationSeconds: args.durationSeconds,
      completedAtMs,
    });

    return formatSessionRecord(recorded.id, recorded);
  },
});

export const clear = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user_completed", (q) => q.eq("userId", user._id))
      .take(4096);

    for (const session of sessions) {
      await ctx.db.delete(session._id);
    }

    return true;
  },
});

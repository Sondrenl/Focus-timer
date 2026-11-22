import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireUser, getAuthenticatedUser } from "./authHelper";
import {
  assertValidTagId,
  assertValidTimerRunId,
  MAX_FUTURE_TIMESTAMP_SKEW_MS,
  recordCompletedSessionIfNotDuplicate,
} from "./timerHelpers";

interface SessionData {
  tagId?: string | null;
  sessionType: "WORK" | "SHORT_BREAK" | "LONG_BREAK";
  durationSeconds: number;
  completedAt: string;
  timerRunId?: string | null;
}

function formatSessionRecord(id: string, s: SessionData) {
  return {
    id,
    tagId: s.tagId ?? null,
    sessionType: s.sessionType,
    durationSeconds: s.durationSeconds,
    completedAt: s.completedAt,
    ...(s.timerRunId ? { timerRunId: s.timerRunId } : {}),
  };
}

function normalizeIsoBound(raw: string, bound: "start" | "end"): string {
  if (raw.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return bound === "start" ? `${raw}T00:00:00.000Z` : `${raw}T23:59:59.999Z`;
  }
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString();
  }
  return raw;
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
        ? normalizeIsoBound(args.startDate, "start")
        : "1970-01-01T00:00:00.000Z";
      const end = args.endDate
        ? normalizeIsoBound(args.endDate, "end")
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
    timerRunId: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, true);
    if (!Number.isFinite(args.durationSeconds) || args.durationSeconds <= 0 || args.durationSeconds > 86400 * 7) {
      throw new Error("Invalid durationSeconds: must be a positive finite number up to 7 days.");
    }

    assertValidTagId(args.tagId);
    assertValidTimerRunId(args.timerRunId, "timerRunId");

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
      timerRunId: args.timerRunId || undefined,
    });

    return formatSessionRecord(recorded.id, recorded);
  },
});

const CLEAR_BATCH_SIZE = 2048;

export const clearChunkInternal = internalMutation({
  args: {
    userId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user_completed", (q) => q.eq("userId", args.userId))
      .take(CLEAR_BATCH_SIZE);

    for (const session of sessions) {
      await ctx.db.delete(session._id);
    }

    if (sessions.length === CLEAR_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.sessions.clearChunkInternal, {
        userId: args.userId,
      });
    }
    return null;
  },
});

export const clear = mutation({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user_completed", (q) => q.eq("userId", user._id))
      .take(CLEAR_BATCH_SIZE);

    for (const session of sessions) {
      await ctx.db.delete(session._id);
    }

    if (sessions.length === CLEAR_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.sessions.clearChunkInternal, {
        userId: user._id,
      });
    }

    return true;
  },
});

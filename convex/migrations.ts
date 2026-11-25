import { v } from "convex/values";
import { mutation, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireUser, DEFAULT_TAGS } from "./authHelper";
import { sanitizeTagColor, MAX_TAG_NAME_LENGTH, MAX_TAGS_PER_USER } from "./tags";
import { TAG_ID_REGEX } from "./timerHelpers";

const MERGE_DEDUP_SCAN_LIMIT = 4000;

function sanitizeOptionalIso(raw: string | undefined, fallback: string): string {
  if (!raw || raw.length > 64) return fallback;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? fallback : new Date(ms).toISOString();
}

function mintUniqueTagId(validTagIds: Set<string>): string {
  let candidate = `tag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  while (validTagIds.has(candidate)) {
    candidate = `tag-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
  return candidate;
}

export const importBackup = mutation({
  args: {
    mode: v.optional(v.literal("merge")),
    tags: v.array(
      v.object({
        id: v.optional(v.string()),
        name: v.string(),
        color: v.string(),
        isArchived: v.optional(v.boolean()),
        createdAt: v.optional(v.string()),
        updatedAt: v.optional(v.string()),
      })
    ),
    sessions: v.array(
      v.object({
        id: v.optional(v.string()),
        tagId: v.optional(v.union(v.string(), v.null())),
        sessionType: v.union(
          v.literal("WORK"),
          v.literal("SHORT_BREAK"),
          v.literal("LONG_BREAK")
        ),
        durationSeconds: v.number(),
        completedAt: v.string(),
        timerRunId: v.optional(v.union(v.string(), v.null())),
      })
    ),
    coffeeCups: v.optional(
      v.array(
        v.object({
          id: v.optional(v.string()),
          date: v.string(),
          tagId: v.optional(v.union(v.string(), v.null())),
          createdAt: v.optional(v.string()),
        })
      )
    ),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, true);
    if (args.tags.length > 100) {
      throw new Error("Cannot import more than 100 tags.");
    }
    if (args.sessions.length > 10000) {
      throw new Error("Cannot import more than 10,000 sessions in a single backup.");
    }
    if ((args.coffeeCups ?? []).length > 10000) {
      throw new Error("Cannot import more than 10,000 coffee cups in a single backup.");
    }

    const now = new Date().toISOString();

    const cleanIncomingSessions = args.sessions.flatMap((s) => {
      if (
        !Number.isFinite(s.durationSeconds) ||
        s.durationSeconds <= 0 ||
        s.durationSeconds > 86400 * 7
      ) {
        return [];
      }
      const parsedMs = new Date(s.completedAt).getTime();
      if (Number.isNaN(parsedMs)) {
        return [];
      }
      const sanitizedRunId =
        typeof s.timerRunId === "string" && s.timerRunId.trim().length > 0
          ? s.timerRunId.trim().slice(0, 128)
          : undefined;
      return [
        {
          ...s,
          completedAtMs: parsedMs,
          completedAt: new Date(parsedMs).toISOString(),
          timerRunId: sanitizedRunId,
        },
      ];
    });

    const cleanIncomingCups = (args.coffeeCups ?? []).flatMap((c) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date)) {
        return [];
      }
      const parsedMs =
        c.createdAt && c.createdAt.length <= 64
          ? new Date(c.createdAt).getTime()
          : NaN;
      return [
        {
          ...c,
          createdAt: !Number.isNaN(parsedMs) ? new Date(parsedMs).toISOString() : now,
        },
      ];
    });

    const makeSafeTagId = (rawId: string | undefined, validTagIds: Set<string>): string => {
      if (rawId && TAG_ID_REGEX.test(rawId) && !validTagIds.has(rawId)) {
        return rawId;
      }
      return mintUniqueTagId(validTagIds);
    };

    const existingTags = user.tags ?? DEFAULT_TAGS;
    const tagMap = new Map<string, (typeof existingTags)[0]>();
    const tagIdRemap = new Map<string, string>();
    const validTagIds = new Set<string>();

    existingTags.forEach((t) => {
      tagMap.set(t.name.toLowerCase().trim(), t);
      tagIdRemap.set(t.id, t.id);
      validTagIds.add(t.id);
    });

    const mergedTags = [...existingTags];
    for (const incoming of args.tags) {
      const cleanName = incoming.name.trim().slice(0, MAX_TAG_NAME_LENGTH) || "Untitled Tag";
      const key = cleanName.toLowerCase();
      const existingMatch = tagMap.get(key);
      if (existingMatch) {
        if (incoming.id) {
          tagIdRemap.set(incoming.id, existingMatch.id);
        }
      } else {
        const canonicalId = makeSafeTagId(incoming.id, validTagIds);
        const cleanColor = sanitizeTagColor(incoming.color);
        const createdAt = sanitizeOptionalIso(incoming.createdAt, now);
        const updatedAt = sanitizeOptionalIso(incoming.updatedAt, createdAt);
        const newTag = {
          id: canonicalId,
          name: cleanName,
          color: cleanColor,
          isArchived: incoming.isArchived ?? false,
          createdAt,
          updatedAt,
        };
        tagMap.set(key, newTag);
        if (incoming.id) {
          tagIdRemap.set(incoming.id, canonicalId);
        }
        validTagIds.add(canonicalId);
        mergedTags.push(newTag);
      }
    }

    if (mergedTags.length > MAX_TAGS_PER_USER) {
      throw new Error(`Cannot exceed maximum limit of ${MAX_TAGS_PER_USER} tags.`);
    }

    if (mergedTags.length !== existingTags.length || user.tags === undefined) {
      await ctx.db.patch(user._id, { tags: mergedTags });
    }

    const resolveMergedTagId = (rawTagId?: string | null): string | undefined => {
      if (!rawTagId) return undefined;
      const mapped = tagIdRemap.get(rawTagId) ?? rawTagId;
      return validTagIds.has(mapped) && TAG_ID_REGEX.test(mapped) ? mapped : undefined;
    };

    if (cleanIncomingSessions.length > 0) {
      let minIncomingMs = Infinity;
      let maxIncomingMs = -Infinity;
      for (const s of cleanIncomingSessions) {
        if (s.completedAtMs < minIncomingMs) minIncomingMs = s.completedAtMs;
        if (s.completedAtMs > maxIncomingMs) maxIncomingMs = s.completedAtMs;
      }
      const lowerIso = new Date(minIncomingMs - 45_000).toISOString();
      const upperIso = new Date(maxIncomingMs + 45_000).toISOString();

      const existingSessions = await ctx.db
        .query("sessions")
        .withIndex("by_user_completed", (q) =>
          q.eq("userId", user._id).gte("completedAt", lowerIso).lte("completedAt", upperIso)
        )
        .take(MERGE_DEDUP_SCAN_LIMIT);

      const existingRunIds = new Set<string>();
      for (const s of existingSessions) {
        if (s.timerRunId) existingRunIds.add(s.timerRunId);
      }
      const existingSessionKeys = new Set(
        existingSessions.map((s) => `${s.sessionType}-${s.completedAt}`)
      );
      const existingSessionTimestamps = existingSessions.map((s) => ({
        sessionType: s.sessionType,
        ms: new Date(s.completedAt).getTime(),
      }));

      for (const session of cleanIncomingSessions) {
        if (session.timerRunId && existingRunIds.has(session.timerRunId)) {
          continue;
        }
        const key = `${session.sessionType}-${session.completedAt}`;
        const incomingMs = session.completedAtMs;
        const isNearDuplicate = existingSessionTimestamps.some(
          (e) =>
            e.sessionType === session.sessionType &&
            !Number.isNaN(e.ms) &&
            Math.abs(e.ms - incomingMs) <= 45000
        );

        if (!existingSessionKeys.has(key) && !isNearDuplicate) {
          existingSessionKeys.add(key);
          if (session.timerRunId) existingRunIds.add(session.timerRunId);
          existingSessionTimestamps.push({
            sessionType: session.sessionType,
            ms: incomingMs,
          });
          await ctx.db.insert("sessions", {
            userId: user._id,
            tagId: resolveMergedTagId(session.tagId),
            sessionType: session.sessionType,
            durationSeconds: session.durationSeconds,
            completedAt: session.completedAt,
            ...(session.timerRunId ? { timerRunId: session.timerRunId } : {}),
          });
        }
      }
    }

    if (cleanIncomingCups.length > 0) {
      let minDate = cleanIncomingCups[0].date;
      let maxDate = cleanIncomingCups[0].date;
      for (const c of cleanIncomingCups) {
        if (c.date < minDate) minDate = c.date;
        if (c.date > maxDate) maxDate = c.date;
      }

      const existingCups = await ctx.db
        .query("coffee_cups")
        .withIndex("by_user_date", (q) =>
          q.eq("userId", user._id).gte("date", minDate).lte("date", maxDate)
        )
        .take(MERGE_DEDUP_SCAN_LIMIT);
      const existingCupKeys = new Set(
        existingCups.map((c) => `${c.date}-${c.createdAt}`)
      );

      for (const cup of cleanIncomingCups) {
        const key = `${cup.date}-${cup.createdAt}`;
        if (!existingCupKeys.has(key)) {
          existingCupKeys.add(key);
          await ctx.db.insert("coffee_cups", {
            userId: user._id,
            date: cup.date,
            tagId: resolveMergedTagId(cup.tagId),
            createdAt: cup.createdAt,
          });
        }
      }
    }

    return { success: true };
  },
});

const LEGACY_CLEANUP_PAGE_SIZE = 500;

/**
 * One-off maintenance migration: strips removed pre-refactor legacy fields from
 * `session_attempts` and `active_timers` so those optional fields can be deleted
 * from `convex/schema.ts`. Invoke once from the Convex Dashboard (`migrations:stripLegacyFields`).
 */
export const stripLegacyFields = internalMutation({
  args: {
    stage: v.optional(v.union(v.literal("session_attempts"), v.literal("active_timers"))),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.object({
    stage: v.string(),
    patchedCount: v.number(),
    scheduledNext: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const stage = args.stage ?? "session_attempts";
    const cursor = args.cursor ?? null;
    let patchedCount = 0;

    if (stage === "session_attempts") {
      const page = await ctx.db
        .query("session_attempts")
        .paginate({ numItems: LEGACY_CLEANUP_PAGE_SIZE, cursor });

      for (const doc of page.page) {
        const hasLegacy =
          doc.timeSincePreviousAttemptSeconds !== undefined ||
          doc.previousAttemptType !== undefined ||
          doc.previousAttemptOutcome !== undefined ||
          doc.workSessionsCompletedToday !== undefined ||
          doc.workActiveSecondsToday !== undefined ||
          doc.skipsToday !== undefined ||
          doc.coffeeCupsTodayAtStart !== undefined ||
          doc.minutesSinceLastCoffeeAtStart !== undefined ||
          doc.coffeeLoggedDuringRun !== undefined;

        if (hasLegacy) {
          await ctx.db.patch(doc._id, {
            timeSincePreviousAttemptSeconds: undefined,
            previousAttemptType: undefined,
            previousAttemptOutcome: undefined,
            workSessionsCompletedToday: undefined,
            workActiveSecondsToday: undefined,
            skipsToday: undefined,
            coffeeCupsTodayAtStart: undefined,
            minutesSinceLastCoffeeAtStart: undefined,
            coffeeLoggedDuringRun: undefined,
          });
          patchedCount += 1;
        }
      }

      if (!page.isDone) {
        await ctx.scheduler.runAfter(0, internal.migrations.stripLegacyFields, {
          stage: "session_attempts",
          cursor: page.continueCursor,
        });
        return { stage, patchedCount, scheduledNext: true };
      }

      await ctx.scheduler.runAfter(0, internal.migrations.stripLegacyFields, {
        stage: "active_timers",
        cursor: null,
      });
      return { stage, patchedCount, scheduledNext: true };
    }

    const page = await ctx.db
      .query("active_timers")
      .paginate({ numItems: LEGACY_CLEANUP_PAGE_SIZE, cursor });

    for (const doc of page.page) {
      if (doc.peerPresence !== undefined) {
        await ctx.db.patch(doc._id, { peerPresence: undefined });
        patchedCount += 1;
      }
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.stripLegacyFields, {
        stage: "active_timers",
        cursor: page.continueCursor,
      });
      return { stage, patchedCount, scheduledNext: true };
    }

    return { stage, patchedCount, scheduledNext: false };
  },
});

import { v } from "convex/values";
import { mutation, MutationCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requireUser, DEFAULT_TAGS } from "./authHelper";
import { sanitizeTagColor, MAX_TAG_NAME_LENGTH, MAX_TAGS_PER_USER } from "./tags";
import { TAG_ID_REGEX } from "./timerHelpers";

const REPLACE_DELETE_BATCH_SIZE = 500;
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

async function deleteReplaceBatchForUser(
  ctx: MutationCtx,
  userId: Id<"users">
): Promise<{ hasMore: boolean }> {
  const existingSessions = await ctx.db
    .query("sessions")
    .withIndex("by_user_completed", (q) => q.eq("userId", userId))
    .take(REPLACE_DELETE_BATCH_SIZE);
  for (const s of existingSessions) {
    await ctx.db.delete(s._id);
  }

  const existingCups = await ctx.db
    .query("coffee_cups")
    .withIndex("by_user_date", (q) => q.eq("userId", userId))
    .take(REPLACE_DELETE_BATCH_SIZE);
  for (const c of existingCups) {
    await ctx.db.delete(c._id);
  }

  const existingAttempts = await ctx.db
    .query("session_attempts")
    .withIndex("by_user_attempt", (q) => q.eq("userId", userId))
    .take(REPLACE_DELETE_BATCH_SIZE);
  for (const a of existingAttempts) {
    await ctx.db.delete(a._id);
  }

  const hasMore =
    existingSessions.length >= REPLACE_DELETE_BATCH_SIZE ||
    existingCups.length >= REPLACE_DELETE_BATCH_SIZE ||
    existingAttempts.length >= REPLACE_DELETE_BATCH_SIZE;

  return { hasMore };
}

export const clearForReplaceBatch = mutation({
  args: {},
  returns: v.object({
    hasMore: v.boolean(),
  }),
  handler: async (ctx) => {
    const user = await requireUser(ctx, true);
    return await deleteReplaceBatchForUser(ctx, user._id);
  },
});

export const importBackup = mutation({
  args: {
    mode: v.union(v.literal("merge"), v.literal("replace")),
    skipReplaceClear: v.optional(v.boolean()),
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

    const isSampleId = (id?: string) =>
      Boolean(id && (id.startsWith("sample-") || id.startsWith("seed-")));

    const cleanIncomingSessions = args.sessions.flatMap((s) => {
      if (
        isSampleId(s.id) ||
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
      if (isSampleId(c.id) || !/^\d{4}-\d{2}-\d{2}$/.test(c.date)) {
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

    if (args.mode === "replace") {
      if (!args.skipReplaceClear) {
        await deleteReplaceBatchForUser(ctx, user._id);
      }

      const tagIdRemap = new Map<string, string>();
      const validTagIds = new Set<string>();
      const seenNames = new Map<string, string>();
      const formattedTags: Array<{
        id: string;
        name: string;
        color: string;
        isArchived: boolean;
        createdAt: string;
        updatedAt: string;
      }> = [];

      for (const t of args.tags) {
        const cleanName = t.name.trim().slice(0, MAX_TAG_NAME_LENGTH) || "Untitled Tag";
        const nameKey = cleanName.toLowerCase();
        const existingByNameId = seenNames.get(nameKey);
        if (existingByNameId) {
          if (t.id) {
            tagIdRemap.set(t.id, existingByNameId);
          }
          continue;
        }

        const canonicalId = makeSafeTagId(t.id, validTagIds);
        if (t.id) {
          tagIdRemap.set(t.id, canonicalId);
        }
        validTagIds.add(canonicalId);
        seenNames.set(nameKey, canonicalId);
        const cleanColor = sanitizeTagColor(t.color);
        const createdAt = sanitizeOptionalIso(t.createdAt, now);
        const updatedAt = sanitizeOptionalIso(t.updatedAt, createdAt);
        formattedTags.push({
          id: canonicalId,
          name: cleanName,
          color: cleanColor,
          isArchived: t.isArchived ?? false,
          createdAt,
          updatedAt,
        });
      }

      if (formattedTags.length > MAX_TAGS_PER_USER) {
        throw new Error(`Cannot exceed maximum limit of ${MAX_TAGS_PER_USER} tags.`);
      }

      await ctx.db.patch(user._id, {
        tags: formattedTags,
      });

      const activeTimer = await ctx.db
        .query("active_timers")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .first();
      if (activeTimer?.tagId && !validTagIds.has(activeTimer.tagId)) {
        await ctx.db.patch(activeTimer._id, {
          tagId: undefined,
          updatedAtMs: Date.now(),
        });
      }

      const resolveTagId = (rawTagId?: string | null): string | undefined => {
        if (!rawTagId) return undefined;
        const mapped = tagIdRemap.get(rawTagId) ?? rawTagId;
        return validTagIds.has(mapped) && TAG_ID_REGEX.test(mapped) ? mapped : undefined;
      };

      for (const session of cleanIncomingSessions) {
        await ctx.db.insert("sessions", {
          userId: user._id,
          tagId: resolveTagId(session.tagId),
          sessionType: session.sessionType,
          durationSeconds: session.durationSeconds,
          completedAt: session.completedAt,
          ...(session.timerRunId ? { timerRunId: session.timerRunId } : {}),
        });
      }

      for (const cup of cleanIncomingCups) {
        await ctx.db.insert("coffee_cups", {
          userId: user._id,
          date: cup.date,
          tagId: resolveTagId(cup.tagId),
          createdAt: cup.createdAt,
        });
      }

      return { success: true };
    }

    // MERGE MODE
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

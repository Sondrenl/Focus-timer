import { v } from "convex/values";
import { mutation, MutationCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requireUser, DEFAULT_TAGS } from "./authHelper";
import { sanitizeTagColor, MAX_TAG_NAME_LENGTH, MAX_TAGS_PER_USER } from "./tags";
import { TAG_ID_REGEX } from "./timerHelpers";
import {
  sessionAttemptInputValidator,
  mlEventInputValidator,
  validateAndNormalizeAttempt,
  validateAndNormalizeEvent,
} from "./telemetryValidators";

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

  const existingEvents = await ctx.db
    .query("ml_events")
    .withIndex("by_user_event", (q) => q.eq("userId", userId))
    .take(REPLACE_DELETE_BATCH_SIZE);
  for (const e of existingEvents) {
    await ctx.db.delete(e._id);
  }

  const hasMore =
    existingSessions.length >= REPLACE_DELETE_BATCH_SIZE ||
    existingCups.length >= REPLACE_DELETE_BATCH_SIZE ||
    existingAttempts.length >= REPLACE_DELETE_BATCH_SIZE ||
    existingEvents.length >= REPLACE_DELETE_BATCH_SIZE;

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
    mlTelemetry: v.optional(
      v.object({
        schemaVersion: v.number(),
        sessionAttempts: v.array(sessionAttemptInputValidator),
        events: v.array(mlEventInputValidator),
      })
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
    if (args.mlTelemetry) {
      if (
        !Number.isFinite(args.mlTelemetry.schemaVersion) ||
        args.mlTelemetry.schemaVersion < 1
      ) {
        throw new Error("Invalid mlTelemetry.schemaVersion.");
      }
      if (args.mlTelemetry.sessionAttempts.length > 1000) {
        throw new Error(
          "Cannot import more than 1,000 session attempts in a single backup."
        );
      }
      if (args.mlTelemetry.events.length > 2000) {
        throw new Error("Cannot import more than 2,000 ML events in a single backup.");
      }
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
      // 1-2b. Clear existing data (bounded) unless caller already pre-cleared via clearForReplaceBatch
      if (!args.skipReplaceClear) {
        await deleteReplaceBatchForUser(ctx, user._id);
      }

      // 3. Format and replace tags, deduplicating by normalized name and ID while keeping remap
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

      // Clear dangling tagId on active_timers if the replaced tag set no longer contains it
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

      // 4. Ingest sessions
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

      // 5. Ingest coffee cups
      for (const cup of cleanIncomingCups) {
        await ctx.db.insert("coffee_cups", {
          userId: user._id,
          date: cup.date,
          tagId: resolveTagId(cup.tagId),
          createdAt: cup.createdAt,
        });
      }

      // 6. Ingest ML telemetry if supplied
      if (args.mlTelemetry) {
        const seenAttemptIds = new Set<string>();
        for (const rawAttempt of args.mlTelemetry.sessionAttempts) {
          if (isSampleId(rawAttempt.attemptId) || seenAttemptIds.has(rawAttempt.attemptId)) {
            continue;
          }
          const parsed = validateAndNormalizeAttempt(rawAttempt);
          if (!parsed.ok) continue;
          seenAttemptIds.add(parsed.value.attemptId);
          await ctx.db.insert("session_attempts", {
            userId: user._id,
            ...parsed.value,
            initialTagId: resolveTagId(parsed.value.initialTagId),
            tagId: resolveTagId(parsed.value.tagId),
          });
        }

        const seenEventIds = new Set<string>();
        for (const rawEvent of args.mlTelemetry.events) {
          if (isSampleId(rawEvent.eventId) || seenEventIds.has(rawEvent.eventId)) {
            continue;
          }
          const parsed = validateAndNormalizeEvent(rawEvent);
          if (!parsed.ok) continue;
          seenEventIds.add(parsed.value.eventId);
          await ctx.db.insert("ml_events", {
            userId: user._id,
            ...parsed.value,
            tagId: resolveTagId(parsed.value.tagId),
            fromTagId: resolveTagId(parsed.value.fromTagId),
            toTagId: resolveTagId(parsed.value.toTagId),
          });
        }
      }

      return { success: true };
    }

    // MERGE MODE
    // 1. Merge tags without duplicating existing names OR existing IDs, and remap incoming tag IDs
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
        // If incoming.id collides with an existing tag ID (e.g. a renamed default tag),
        // mint a fresh unique ID and remap all incoming references to it.
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

    // 2. Ingest sessions with range-bounded deduplication by timerRunId or (sessionType + ±45s)
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

    // 3. Ingest coffee cups with date-range-bounded deduplication by (date + createdAt)
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

    // 4. Ingest ML telemetry if supplied, deduplicating by attemptId / eventId
    // and upgrading stale in_progress attempts when a finalized/newer version is imported
    if (args.mlTelemetry) {
      const seenAttemptIds = new Set<string>();
      for (const rawAttempt of args.mlTelemetry.sessionAttempts) {
        if (isSampleId(rawAttempt.attemptId) || seenAttemptIds.has(rawAttempt.attemptId)) {
          continue;
        }
        const parsed = validateAndNormalizeAttempt(rawAttempt);
        if (!parsed.ok) continue;
        seenAttemptIds.add(parsed.value.attemptId);

        const existing = await ctx.db
          .query("session_attempts")
          .withIndex("by_user_attempt", (q) =>
            q.eq("userId", user._id).eq("attemptId", parsed.value.attemptId)
          )
          .first();

        const resolvedInitialTagId = resolveMergedTagId(parsed.value.initialTagId);
        const resolvedTagId = resolveMergedTagId(parsed.value.tagId);

        if (!existing) {
          await ctx.db.insert("session_attempts", {
            userId: user._id,
            ...parsed.value,
            initialTagId: resolvedInitialTagId,
            tagId: resolvedTagId,
          });
        } else if (
          existing.status === "in_progress" &&
          (parsed.value.status !== "in_progress" ||
            parsed.value.updatedAtMs > existing.updatedAtMs)
        ) {
          await ctx.db.patch(existing._id, {
            ...parsed.value,
            initialTagId: resolvedInitialTagId,
            tagId: resolvedTagId,
          });
        }
      }

      const seenEventIds = new Set<string>();
      for (const rawEvent of args.mlTelemetry.events) {
        if (isSampleId(rawEvent.eventId) || seenEventIds.has(rawEvent.eventId)) {
          continue;
        }
        const parsed = validateAndNormalizeEvent(rawEvent);
        if (!parsed.ok) continue;
        seenEventIds.add(parsed.value.eventId);

        const existing = await ctx.db
          .query("ml_events")
          .withIndex("by_user_event", (q) =>
            q.eq("userId", user._id).eq("eventId", parsed.value.eventId)
          )
          .first();

        if (!existing) {
          await ctx.db.insert("ml_events", {
            userId: user._id,
            ...parsed.value,
            tagId: resolveMergedTagId(parsed.value.tagId),
            fromTagId: resolveMergedTagId(parsed.value.fromTagId),
            toTagId: resolveMergedTagId(parsed.value.toTagId),
          });
        }
      }
    }

    return { success: true };
  },
});

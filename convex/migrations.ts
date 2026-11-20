import { v } from "convex/values";
import { mutation, MutationCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requireUser } from "./authHelper";
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
      return [
        {
          ...s,
          completedAtMs: parsedMs,
          completedAt: new Date(parsedMs).toISOString(),
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

    const makeSafeTagId = (rawId?: string): string =>
      rawId && TAG_ID_REGEX.test(rawId)
        ? rawId
        : `tag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    if (args.mode === "replace") {
      // 1-2b. Clear existing data (bounded) unless caller already pre-cleared via clearForReplaceBatch
      if (!args.skipReplaceClear) {
        await deleteReplaceBatchForUser(ctx, user._id);
      }

      // 3. Format and replace tags, keeping track of valid/remapped tag IDs
      const tagIdRemap = new Map<string, string>();
      const validTagIds = new Set<string>();
      const formattedTags = args.tags.map((t) => {
        const canonicalId = makeSafeTagId(t.id);
        if (t.id) {
          tagIdRemap.set(t.id, canonicalId);
        }
        validTagIds.add(canonicalId);
        const cleanName = t.name.trim().slice(0, MAX_TAG_NAME_LENGTH) || "Untitled Tag";
        const cleanColor = sanitizeTagColor(t.color);
        return {
          id: canonicalId,
          name: cleanName,
          color: cleanColor,
          isArchived: t.isArchived ?? false,
          createdAt: now,
          updatedAt: now,
        };
      });

      await ctx.db.patch(user._id, {
        tags: formattedTags,
      });

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
    // 1. Merge tags without duplicating existing names, and remap incoming tag IDs to canonical tag IDs
    const existingTags = user.tags || [];
    const tagMap = new Map<string, typeof existingTags[0]>();
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
        const canonicalId = makeSafeTagId(incoming.id);
        const cleanColor = sanitizeTagColor(incoming.color);
        const newTag = {
          id: canonicalId,
          name: cleanName,
          color: cleanColor,
          isArchived: incoming.isArchived ?? false,
          createdAt: now,
          updatedAt: now,
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

    if (mergedTags.length !== existingTags.length) {
      await ctx.db.patch(user._id, { tags: mergedTags });
    }

    const resolveMergedTagId = (rawTagId?: string | null): string | undefined => {
      if (!rawTagId) return undefined;
      const mapped = tagIdRemap.get(rawTagId) ?? rawTagId;
      return validTagIds.has(mapped) && TAG_ID_REGEX.test(mapped) ? mapped : undefined;
    };

    // 2. Ingest sessions with deduplication by (sessionType + completedAt within ±45s)
    const existingSessions = await ctx.db
      .query("sessions")
      .withIndex("by_user_completed", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(MERGE_DEDUP_SCAN_LIMIT);
    const existingSessionKeys = new Set(
      existingSessions.map((s) => `${s.sessionType}-${s.completedAt}`)
    );
    const existingSessionTimestamps = existingSessions.map((s) => ({
      sessionType: s.sessionType,
      ms: new Date(s.completedAt).getTime(),
    }));

    for (const session of cleanIncomingSessions) {
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
        });
      }
    }

    // 3. Ingest coffee cups with deduplication by (date + createdAt)
    if (cleanIncomingCups.length > 0) {
      const existingCups = await ctx.db
        .query("coffee_cups")
        .withIndex("by_user_date", (q) => q.eq("userId", user._id))
        .order("desc")
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

        if (!existing) {
          await ctx.db.insert("session_attempts", {
            userId: user._id,
            ...parsed.value,
            initialTagId: resolveMergedTagId(parsed.value.initialTagId),
            tagId: resolveMergedTagId(parsed.value.tagId),
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

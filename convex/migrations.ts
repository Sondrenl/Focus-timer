import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireUser } from "./authHelper";

export const importBackup = mutation({
  args: {
    mode: v.union(v.literal("merge"), v.literal("replace")),
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
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, true);
    const now = new Date().toISOString();

    const isSampleId = (id?: string) =>
      Boolean(id && (id.startsWith("sample-") || id.startsWith("seed-")));

    const cleanIncomingSessions = args.sessions.filter((s) => !isSampleId(s.id));
    const cleanIncomingCups = (args.coffeeCups ?? []).filter((c) => !isSampleId(c.id));

    if (args.mode === "replace") {
      // 1. Clear existing sessions
      const existingSessions = await ctx.db
        .query("sessions")
        .withIndex("by_user_completed", (q) => q.eq("userId", user._id))
        .collect();
      for (const s of existingSessions) {
        await ctx.db.delete(s._id);
      }

      // 2. Clear existing coffee cups
      const existingCups = await ctx.db
        .query("coffee_cups")
        .withIndex("by_user_date", (q) => q.eq("userId", user._id))
        .collect();
      for (const c of existingCups) {
        await ctx.db.delete(c._id);
      }

      // 3. Format and replace tags, keeping track of valid/remapped tag IDs
      const tagIdRemap = new Map<string, string>();
      const validTagIds = new Set<string>();
      const formattedTags = args.tags.map((t) => {
        const canonicalId =
          t.id ?? `tag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        if (t.id) {
          tagIdRemap.set(t.id, canonicalId);
        }
        validTagIds.add(canonicalId);
        return {
          id: canonicalId,
          name: t.name.trim(),
          color: t.color,
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
        return validTagIds.has(mapped) ? mapped : undefined;
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
          createdAt: cup.createdAt ?? now,
        });
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
      const key = incoming.name.toLowerCase().trim();
      const existingMatch = tagMap.get(key);
      if (existingMatch) {
        if (incoming.id) {
          tagIdRemap.set(incoming.id, existingMatch.id);
        }
      } else {
        const canonicalId =
          incoming.id ?? `tag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const newTag = {
          id: canonicalId,
          name: incoming.name.trim(),
          color: incoming.color,
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

    if (mergedTags.length !== existingTags.length) {
      await ctx.db.patch(user._id, { tags: mergedTags });
    }

    const resolveMergedTagId = (rawTagId?: string | null): string | undefined => {
      if (!rawTagId) return undefined;
      const mapped = tagIdRemap.get(rawTagId) ?? rawTagId;
      return validTagIds.has(mapped) ? mapped : undefined;
    };

    // 2. Ingest sessions with deduplication by (sessionType + completedAt within ±45s)
    const existingSessions = await ctx.db
      .query("sessions")
      .withIndex("by_user_completed", (q) => q.eq("userId", user._id))
      .collect();
    const existingSessionKeys = new Set(
      existingSessions.map((s) => `${s.sessionType}-${s.completedAt}`)
    );
    const existingSessionTimestamps = existingSessions.map((s) => ({
      sessionType: s.sessionType,
      ms: new Date(s.completedAt).getTime(),
    }));

    for (const session of cleanIncomingSessions) {
      const key = `${session.sessionType}-${session.completedAt}`;
      const incomingMs = new Date(session.completedAt).getTime();
      const isNearDuplicate =
        !isNaN(incomingMs) &&
        existingSessionTimestamps.some(
          (e) =>
            e.sessionType === session.sessionType &&
            !isNaN(e.ms) &&
            Math.abs(e.ms - incomingMs) <= 45000
        );

      if (!existingSessionKeys.has(key) && !isNearDuplicate) {
        existingSessionKeys.add(key);
        if (!isNaN(incomingMs)) {
          existingSessionTimestamps.push({
            sessionType: session.sessionType,
            ms: incomingMs,
          });
        }
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
        .collect();
      const existingCupKeys = new Set(
        existingCups.map((c) => `${c.date}-${c.createdAt}`)
      );

      for (const cup of cleanIncomingCups) {
        const cupCreatedAt = cup.createdAt ?? now;
        const key = `${cup.date}-${cupCreatedAt}`;
        if (!existingCupKeys.has(key)) {
          existingCupKeys.add(key);
          await ctx.db.insert("coffee_cups", {
            userId: user._id,
            date: cup.date,
            tagId: resolveMergedTagId(cup.tagId),
            createdAt: cupCreatedAt,
          });
        }
      }
    }

    return { success: true };
  },
});

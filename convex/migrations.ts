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
      })
    ),
    sessions: v.array(
      v.object({
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

      // 3. Format and replace tags
      const formattedTags = args.tags.map((t) => ({
        id: t.id ?? `tag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: t.name.trim(),
        color: t.color,
        isArchived: t.isArchived ?? false,
        createdAt: now,
        updatedAt: now,
      }));

      await ctx.db.patch(user._id, {
        tags: formattedTags,
      });

      // 4. Ingest sessions
      for (const session of args.sessions) {
        await ctx.db.insert("sessions", {
          userId: user._id,
          tagId: session.tagId || undefined,
          sessionType: session.sessionType,
          durationSeconds: session.durationSeconds,
          completedAt: session.completedAt,
        });
      }

      // 5. Ingest coffee cups
      if (args.coffeeCups) {
        for (const cup of args.coffeeCups) {
          await ctx.db.insert("coffee_cups", {
            userId: user._id,
            date: cup.date,
            tagId: cup.tagId || undefined,
            createdAt: cup.createdAt ?? now,
          });
        }
      }

      return { success: true };
    }

    // MERGE MODE
    // 1. Merge tags without duplicating existing names
    const existingTags = user.tags || [];
    const tagMap = new Map<string, typeof existingTags[0]>();
    existingTags.forEach((t) => tagMap.set(t.name.toLowerCase().trim(), t));

    const mergedTags = [...existingTags];
    for (const incoming of args.tags) {
      const key = incoming.name.toLowerCase().trim();
      if (!tagMap.has(key)) {
        const newTag = {
          id: incoming.id ?? `tag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: incoming.name.trim(),
          color: incoming.color,
          isArchived: incoming.isArchived ?? false,
          createdAt: now,
          updatedAt: now,
        };
        tagMap.set(key, newTag);
        mergedTags.push(newTag);
      }
    }

    if (mergedTags.length !== existingTags.length) {
      await ctx.db.patch(user._id, { tags: mergedTags });
    }

    // 2. Ingest sessions with deduplication by (sessionType + completedAt)
    const existingSessions = await ctx.db
      .query("sessions")
      .withIndex("by_user_completed", (q) => q.eq("userId", user._id))
      .collect();
    const existingSessionKeys = new Set(
      existingSessions.map((s) => `${s.sessionType}-${s.completedAt}`)
    );

    for (const session of args.sessions) {
      const key = `${session.sessionType}-${session.completedAt}`;
      if (!existingSessionKeys.has(key)) {
        existingSessionKeys.add(key);
        await ctx.db.insert("sessions", {
          userId: user._id,
          tagId: session.tagId || undefined,
          sessionType: session.sessionType,
          durationSeconds: session.durationSeconds,
          completedAt: session.completedAt,
        });
      }
    }

    // 3. Ingest coffee cups with deduplication by (date + createdAt)
    if (args.coffeeCups) {
      const existingCups = await ctx.db
        .query("coffee_cups")
        .withIndex("by_user_date", (q) => q.eq("userId", user._id))
        .collect();
      const existingCupKeys = new Set(
        existingCups.map((c) => `${c.date}-${c.createdAt}`)
      );

      for (const cup of args.coffeeCups) {
        const cupCreatedAt = cup.createdAt ?? now;
        const key = `${cup.date}-${cupCreatedAt}`;
        if (!existingCupKeys.has(key)) {
          existingCupKeys.add(key);
          await ctx.db.insert("coffee_cups", {
            userId: user._id,
            date: cup.date,
            tagId: cup.tagId || undefined,
            createdAt: cupCreatedAt,
          });
        }
      }
    }

    return { success: true };
  },
});

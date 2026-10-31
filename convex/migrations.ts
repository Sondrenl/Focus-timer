import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireUser } from "./authHelper";

export const importBackup = mutation({
  args: {
    tags: v.array(
      v.object({
        name: v.string(),
        color: v.string(),
        isArchived: v.optional(v.boolean()),
      })
    ),
    sessions: v.array(
      v.object({
        tagId: v.optional(v.string()),
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
          tagId: v.optional(v.string()),
          createdAt: v.optional(v.string()),
        })
      )
    ),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, true);
    const now = new Date().toISOString();

    // 1. Ingest tags
    for (const tag of args.tags) {
      await ctx.db.insert("tags", {
        userId: user._id,
        name: tag.name,
        color: tag.color,
        isArchived: tag.isArchived ?? false,
        createdAt: now,
        updatedAt: now,
      });
    }

    // 2. Ingest sessions
    for (const session of args.sessions) {
      await ctx.db.insert("sessions", {
        userId: user._id,
        tagId: session.tagId,
        sessionType: session.sessionType,
        durationSeconds: session.durationSeconds,
        completedAt: session.completedAt,
      });
    }

    // 3. Ingest coffee cups
    if (args.coffeeCups) {
      for (const cup of args.coffeeCups) {
        await ctx.db.insert("coffee_cups", {
          userId: user._id,
          date: cup.date,
          tagId: cup.tagId,
          createdAt: cup.createdAt ?? now,
        });
      }
    }

    return { success: true };
  },
});

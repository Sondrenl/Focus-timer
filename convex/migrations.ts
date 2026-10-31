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

    // Daily aggregates map to populate in bulk
    const dailyMap: Record<
      string,
      {
        workSeconds: number;
        workSessionsCount: number;
        shortBreakSeconds: number;
        longBreakSeconds: number;
        coffeeCount: number;
        tagSeconds: Record<string, number>;
        tagCoffee: Record<string, number>;
      }
    > = {};

    const getDaily = (date: string) => {
      if (!dailyMap[date]) {
        dailyMap[date] = {
          workSeconds: 0,
          workSessionsCount: 0,
          shortBreakSeconds: 0,
          longBreakSeconds: 0,
          coffeeCount: 0,
          tagSeconds: {},
          tagCoffee: {},
        };
      }
      return dailyMap[date];
    };

    // 2. Ingest sessions & aggregate
    for (const session of args.sessions) {
      const date = session.completedAt.slice(0, 10);
      await ctx.db.insert("sessions", {
        userId: user._id,
        tagId: session.tagId,
        sessionType: session.sessionType,
        durationSeconds: session.durationSeconds,
        completedAt: session.completedAt,
        date,
      });

      const d = getDaily(date);
      if (session.sessionType === "WORK") {
        d.workSeconds += session.durationSeconds;
        d.workSessionsCount += 1;
        if (session.tagId) {
          d.tagSeconds[session.tagId] = (d.tagSeconds[session.tagId] ?? 0) + session.durationSeconds;
        }
      } else if (session.sessionType === "SHORT_BREAK") {
        d.shortBreakSeconds += session.durationSeconds;
      } else if (session.sessionType === "LONG_BREAK") {
        d.longBreakSeconds += session.durationSeconds;
      }
    }

    // 3. Ingest coffee cups & aggregate
    if (args.coffeeCups) {
      for (const cup of args.coffeeCups) {
        const createdAt = cup.createdAt ?? now;
        await ctx.db.insert("coffee_cups", {
          userId: user._id,
          date: cup.date,
          tagId: cup.tagId,
          createdAt,
          timestamp: new Date(createdAt).getTime(),
        });

        const d = getDaily(cup.date);
        d.coffeeCount += 1;
        if (cup.tagId) {
          d.tagCoffee[cup.tagId] = (d.tagCoffee[cup.tagId] ?? 0) + 1;
        }
      }
    }

    // 4. Commit daily aggregates
    for (const [date, agg] of Object.entries(dailyMap)) {
      const existing = await ctx.db
        .query("daily_stats")
        .withIndex("by_user_date", (q) =>
          q.eq("userId", user._id).eq("date", date)
        )
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          workSeconds: existing.workSeconds + agg.workSeconds,
          workSessionsCount: existing.workSessionsCount + agg.workSessionsCount,
          shortBreakSeconds: existing.shortBreakSeconds + agg.shortBreakSeconds,
          longBreakSeconds: existing.longBreakSeconds + agg.longBreakSeconds,
          coffeeCount: existing.coffeeCount + agg.coffeeCount,
          tagSeconds: { ...existing.tagSeconds, ...agg.tagSeconds },
          tagCoffee: { ...existing.tagCoffee, ...agg.tagCoffee },
        });
      } else {
        await ctx.db.insert("daily_stats", {
          userId: user._id,
          date,
          ...agg,
        });
      }
    }

    return { success: true };
  },
});

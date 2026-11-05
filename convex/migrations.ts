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
      for (const session of args.sessions) {
        await ctx.db.insert("sessions", {
          userId: user._id,
          tagId: resolveTagId(session.tagId),
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
            tagId: resolveTagId(cup.tagId),
            createdAt: cup.createdAt ?? now,
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

    for (const session of args.sessions) {
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
            tagId: resolveMergedTagId(cup.tagId),
            createdAt: cupCreatedAt,
          });
        }
      }
    }

    return { success: true };
  },
});


export const importD1Data = mutation({
  args: {
    users: v.array(
      v.object({
        email: v.string(),
        googleId: v.string(),
        displayName: v.string(),
        avatarUrl: v.optional(v.string()),
        avatarEmoji: v.string(),
        dailyGoalMinutes: v.number(),
        createdAt: v.string(),
        settings: v.object({
          workDurationMinutes: v.number(),
          shortBreakDurationMinutes: v.number(),
          longBreakDurationMinutes: v.number(),
          longBreakInterval: v.number(),
          autoStartBreaks: v.boolean(),
          autoStartPomodoros: v.boolean(),
          soundVolume: v.number(),
          soundEnabled: v.boolean(),
          notificationsEnabled: v.boolean(),
          keepAwake: v.boolean(),
          updatedAt: v.string(),
        }),
        tags: v.array(
          v.object({
            id: v.string(),
            name: v.string(),
            color: v.string(),
            isArchived: v.boolean(),
            createdAt: v.string(),
            updatedAt: v.optional(v.string()),
          })
        ),
      })
    ),
    sessions: v.array(
      v.object({
        userEmail: v.string(),
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
    coffeeCups: v.array(
      v.object({
        userEmail: v.string(),
        tagId: v.optional(v.union(v.string(), v.null())),
        date: v.string(),
        createdAt: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const userMap = new Map<string, any>();

    for (const u of args.users) {
      const tokenIdentifier = `https://accounts.google.com|${u.googleId}`;
      let user = await ctx.db
        .query("users")
        .withIndex("by_token", (q) => q.eq("tokenIdentifier", tokenIdentifier))
        .unique();

      if (!user) {
        user = await ctx.db
          .query("users")
          .filter((q) => q.eq(q.field("email"), u.email))
          .first();
      }

      if (user) {
        // Merge tags
        const existingTags = user.tags || [];
        const tagMap = new Map<string, typeof existingTags[0]>();
        existingTags.forEach((t) => tagMap.set(t.name.toLowerCase().trim(), t));
        const mergedTags = [...existingTags];
        for (const t of u.tags) {
          if (!tagMap.has(t.name.toLowerCase().trim())) {
            tagMap.set(t.name.toLowerCase().trim(), t);
            mergedTags.push(t);
          }
        }

        await ctx.db.patch(user._id, {
          tokenIdentifier,
          displayName: user.displayName || u.displayName,
          avatarUrl: user.avatarUrl || u.avatarUrl,
          tags: mergedTags,
        });
        userMap.set(u.email, user._id);
      } else {
        const userId = await ctx.db.insert("users", {
          tokenIdentifier,
          email: u.email,
          displayName: u.displayName,
          avatarUrl: u.avatarUrl,
          avatarEmoji: u.avatarEmoji || "",
          dailyGoalMinutes: u.dailyGoalMinutes || 120,
          createdAt: u.createdAt,
          settings: u.settings,
          tags: u.tags,
        });
        userMap.set(u.email, userId);
      }
    }

    let sessionsImported = 0;
    for (const s of args.sessions) {
      const userId = userMap.get(s.userEmail);
      if (!userId) continue;

      const existing = await ctx.db
        .query("sessions")
        .withIndex("by_user_completed", (q) =>
          q.eq("userId", userId).eq("completedAt", s.completedAt)
        )
        .first();

      if (!existing) {
        await ctx.db.insert("sessions", {
          userId,
          tagId: s.tagId || undefined,
          sessionType: s.sessionType,
          durationSeconds: s.durationSeconds,
          completedAt: s.completedAt,
        });
        sessionsImported++;
      }
    }

    let cupsImported = 0;
    for (const c of args.coffeeCups) {
      const userId = userMap.get(c.userEmail);
      if (!userId) continue;

      const existing = await ctx.db
        .query("coffee_cups")
        .withIndex("by_user_date", (q) =>
          q.eq("userId", userId).eq("date", c.date)
        )
        .filter((q) => q.eq(q.field("createdAt"), c.createdAt))
        .first();

      if (!existing) {
        await ctx.db.insert("coffee_cups", {
          userId,
          date: c.date,
          tagId: c.tagId || undefined,
          createdAt: c.createdAt,
        });
        cupsImported++;
      }
    }

    return {
      usersMigrated: args.users.length,
      sessionsImported,
      cupsImported,
    };
  },
});


export const debugInspectData = mutation({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query('users').collect();
    const sessions = await ctx.db.query('sessions').take(10);
    const totalSessions = (await ctx.db.query('sessions').collect()).length;
    const totalCups = (await ctx.db.query('coffee_cups').collect()).length;
    return {
      totalSessions,
      totalCups,
      users: users.map(u => ({ id: u._id, email: u.email, tokenIdentifier: u.tokenIdentifier, tagsCount: (u.tags || []).length })),
      sampleSessionUserIds: sessions.map(s => s.userId),
    };
  },
});

export const debugInspectActiveTimers = mutation({
  args: {},
  handler: async (ctx) => {
    const timers = await ctx.db.query('active_timers').collect();
    const users = await ctx.db.query('users').collect();
    return { timers, users };
  },
});

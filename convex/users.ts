import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthenticatedUser, requireUser, DEFAULT_SETTINGS, DEFAULT_TAGS } from "./authHelper";

/**
 * Returns the currently authenticated user with their embedded preferences and tags.
 * Provides the entire core application shell in a single atomic reactive query!
 */
export const current = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return null;

    return {
      id: user._id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      avatarEmoji: user.avatarEmoji,
      dailyGoalMinutes: user.dailyGoalMinutes,
      createdAt: user.createdAt,
      settings: user.settings,
      tags: user.tags ?? DEFAULT_TAGS,
    };
  },
});

export const updateProfile = mutation({
  args: {
    displayName: v.optional(v.string()),
    avatarEmoji: v.optional(v.string()),
    dailyGoalMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, true);
    const updates: Record<string, any> = {};
    if (args.displayName !== undefined && args.displayName.trim() !== user.displayName) {
      updates.displayName = args.displayName.trim();
    }
    if (args.avatarEmoji !== undefined && args.avatarEmoji !== user.avatarEmoji) {
      updates.avatarEmoji = args.avatarEmoji;
    }
    if (args.dailyGoalMinutes !== undefined && args.dailyGoalMinutes !== user.dailyGoalMinutes) {
      updates.dailyGoalMinutes = args.dailyGoalMinutes;
    }

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(user._id, updates);
      return await ctx.db.get(user._id);
    }
    return user;
  },
});

export const updateSettings = mutation({
  args: {
    workDurationMinutes: v.optional(v.number()),
    shortBreakDurationMinutes: v.optional(v.number()),
    longBreakDurationMinutes: v.optional(v.number()),
    longBreakInterval: v.optional(v.number()),
    autoStartBreaks: v.optional(v.boolean()),
    autoStartPomodoros: v.optional(v.boolean()),
    soundVolume: v.optional(v.number()),
    soundEnabled: v.optional(v.boolean()),
    notificationsEnabled: v.optional(v.boolean()),
    keepAwake: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, true);
    const now = new Date().toISOString();

    const cleanUpdates = Object.fromEntries(
      Object.entries(args).filter(([_, val]) => val !== undefined)
    );

    const currentSettings = user.settings ?? DEFAULT_SETTINGS;
    const hasChanges = Object.entries(cleanUpdates).some(
      ([key, val]) => (currentSettings as any)[key] !== val
    );

    if (!hasChanges) {
      return currentSettings;
    }

    const mergedSettings = {
      ...currentSettings,
      ...cleanUpdates,
      updatedAt: now,
    };

    await ctx.db.patch(user._id, {
      settings: mergedSettings,
    });

    return mergedSettings;
  },
});

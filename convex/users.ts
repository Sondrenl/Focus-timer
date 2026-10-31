import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthenticatedUser, requireUser, DEFAULT_SETTINGS } from "./authHelper";

export const getProfile = query({
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
    if (args.displayName !== undefined) updates.displayName = args.displayName;
    if (args.avatarEmoji !== undefined) updates.avatarEmoji = args.avatarEmoji;
    if (args.dailyGoalMinutes !== undefined) updates.dailyGoalMinutes = args.dailyGoalMinutes;

    await ctx.db.patch(user._id, updates);
    return await ctx.db.get(user._id);
  },
});

export const getSettings = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return DEFAULT_SETTINGS;

    const settings = await ctx.db
      .query("user_settings")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    return settings ?? DEFAULT_SETTINGS;
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
    const existing = await ctx.db
      .query("user_settings")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    const now = new Date().toISOString();
    const cleanUpdates = Object.fromEntries(
      Object.entries(args).filter(([_, val]) => val !== undefined)
    );

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...cleanUpdates,
        updatedAt: now,
      });
      return await ctx.db.get(existing._id);
    } else {
      const id = await ctx.db.insert("user_settings", {
        userId: user._id,
        ...DEFAULT_SETTINGS,
        ...cleanUpdates,
        updatedAt: now,
      });
      return await ctx.db.get(id);
    }
  },
});

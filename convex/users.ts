import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import { getAuthenticatedUser, requireUser, DEFAULT_SETTINGS, DEFAULT_TAGS } from "./authHelper";
import {
  MIN_DURATION_MINUTES,
  MAX_WORK_DURATION_MINUTES,
  MAX_SHORT_BREAK_MINUTES,
  MAX_LONG_BREAK_MINUTES,
  MAX_LONG_BREAK_INTERVAL,
  MAX_DAILY_GOAL_MINUTES,
} from "./defaultData";

function assertRange(val: number | undefined, min: number, max: number, label: string): void {
  if (val !== undefined && (!Number.isFinite(val) || val < min || val > max)) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
}

export const current = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return null;

    return {
      id: user._id,
      email: user.email || "",
      displayName: user.displayName || user.name || user.email?.split("@")[0] || "Focus Practitioner",
      avatarUrl: user.avatarUrl || user.image,
      avatarEmoji: user.avatarEmoji || "",
      dailyGoalMinutes: user.dailyGoalMinutes ?? 120,
      createdAt: user.createdAt || new Date(user._creationTime).toISOString(),
      settings: user.settings || DEFAULT_SETTINGS,
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
    const updates: Record<string, unknown> = {};

    if (args.displayName !== undefined) {
      const trimmed = args.displayName.trim();
      if (trimmed.length > 100) {
        throw new Error("Display name cannot exceed 100 characters.");
      }
      if (trimmed !== user.displayName) {
        updates.displayName = trimmed;
        updates.name = trimmed;
      }
    }
    if (args.avatarEmoji !== undefined) {
      const trimmedEmoji = args.avatarEmoji.trim();
      if (trimmedEmoji.length > 32) {
        throw new Error("Avatar emoji cannot exceed 32 characters.");
      }
      if (trimmedEmoji !== user.avatarEmoji) {
        updates.avatarEmoji = trimmedEmoji;
      }
    }
    if (args.dailyGoalMinutes !== undefined) {
      assertRange(args.dailyGoalMinutes, 1, MAX_DAILY_GOAL_MINUTES, "Daily goal minutes");
      if (args.dailyGoalMinutes !== user.dailyGoalMinutes) {
        updates.dailyGoalMinutes = args.dailyGoalMinutes;
      }
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

    assertRange(args.workDurationMinutes, MIN_DURATION_MINUTES, MAX_WORK_DURATION_MINUTES, "workDurationMinutes");
    assertRange(args.shortBreakDurationMinutes, MIN_DURATION_MINUTES, MAX_SHORT_BREAK_MINUTES, "shortBreakDurationMinutes");
    assertRange(args.longBreakDurationMinutes, MIN_DURATION_MINUTES, MAX_LONG_BREAK_MINUTES, "longBreakDurationMinutes");
    assertRange(args.longBreakInterval, 1, MAX_LONG_BREAK_INTERVAL, "longBreakInterval");
    assertRange(args.soundVolume, 0, 1, "soundVolume");

    const cleanUpdates = Object.fromEntries(
      Object.entries(args).filter(([, val]) => val !== undefined)
    );

    const currentSettings = user.settings ?? DEFAULT_SETTINGS;
    const hasChanges = Object.entries(cleanUpdates).some(
      ([key, val]) => (currentSettings as Record<string, unknown>)[key] !== val
    );
    if (!hasChanges) return currentSettings;

    const mergedSettings = {
      ...currentSettings,
      ...cleanUpdates,
      updatedAt: new Date().toISOString(),
    };

    await ctx.db.patch(user._id, { settings: mergedSettings });
    return mergedSettings;
  },
});

export const getOrCreateUserForAuth = internalMutation({
  args: {
    email: v.string(),
    sub: v.string(),
    name: v.string(),
    avatarUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const canonicalTokenId = `https://accounts.google.com|${args.sub}`;
    const safeAvatar =
      args.avatarUrl && args.avatarUrl.startsWith("https://") && args.avatarUrl.length <= 2048
        ? args.avatarUrl
        : undefined;

    const existing =
      (await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", args.email))
        .first()) ??
      (await ctx.db
        .query("users")
        .withIndex("by_token", (q) => q.eq("tokenIdentifier", canonicalTokenId))
        .first());

    if (existing) {
      const patchData: Record<string, unknown> = {};
      if (existing.email !== args.email) patchData.email = args.email;
      if (!existing.emailVerificationTime) patchData.emailVerificationTime = Date.now();
      if (!existing.displayName && args.name) patchData.displayName = args.name;
      if (!existing.name && args.name) patchData.name = args.name;
      if (safeAvatar && existing.avatarUrl !== safeAvatar) {
        patchData.avatarUrl = safeAvatar;
        patchData.image = safeAvatar;
      }
      if (!existing.tokenIdentifier || existing.tokenIdentifier !== canonicalTokenId) {
        patchData.tokenIdentifier = canonicalTokenId;
      }
      if (Object.keys(patchData).length > 0) {
        await ctx.db.patch(existing._id, patchData);
      }
      return existing._id;
    }

    const now = new Date().toISOString();
    return await ctx.db.insert("users", {
      email: args.email,
      name: args.name,
      displayName: args.name,
      avatarUrl: safeAvatar,
      image: safeAvatar,
      avatarEmoji: "",
      dailyGoalMinutes: 120,
      createdAt: now,
      emailVerificationTime: Date.now(),
      tokenIdentifier: canonicalTokenId,
      settings: { ...DEFAULT_SETTINGS, updatedAt: now },
      tags: DEFAULT_TAGS,
    });
  },
});

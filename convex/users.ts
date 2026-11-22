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
    const updates: Record<string, any> = {};
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
      if (
        !Number.isFinite(args.dailyGoalMinutes) ||
        args.dailyGoalMinutes < 1 ||
        args.dailyGoalMinutes > MAX_DAILY_GOAL_MINUTES
      ) {
        throw new Error(`Daily goal minutes must be between 1 and ${MAX_DAILY_GOAL_MINUTES}.`);
      }
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

    if (
      args.workDurationMinutes !== undefined &&
      (!Number.isFinite(args.workDurationMinutes) ||
        args.workDurationMinutes < MIN_DURATION_MINUTES ||
        args.workDurationMinutes > MAX_WORK_DURATION_MINUTES)
    ) {
      throw new Error(
        `workDurationMinutes must be between ${MIN_DURATION_MINUTES} and ${MAX_WORK_DURATION_MINUTES}.`
      );
    }
    if (
      args.shortBreakDurationMinutes !== undefined &&
      (!Number.isFinite(args.shortBreakDurationMinutes) ||
        args.shortBreakDurationMinutes < MIN_DURATION_MINUTES ||
        args.shortBreakDurationMinutes > MAX_SHORT_BREAK_MINUTES)
    ) {
      throw new Error(
        `shortBreakDurationMinutes must be between ${MIN_DURATION_MINUTES} and ${MAX_SHORT_BREAK_MINUTES}.`
      );
    }
    if (
      args.longBreakDurationMinutes !== undefined &&
      (!Number.isFinite(args.longBreakDurationMinutes) ||
        args.longBreakDurationMinutes < MIN_DURATION_MINUTES ||
        args.longBreakDurationMinutes > MAX_LONG_BREAK_MINUTES)
    ) {
      throw new Error(
        `longBreakDurationMinutes must be between ${MIN_DURATION_MINUTES} and ${MAX_LONG_BREAK_MINUTES}.`
      );
    }
    if (
      args.longBreakInterval !== undefined &&
      (!Number.isFinite(args.longBreakInterval) ||
        args.longBreakInterval < 1 ||
        args.longBreakInterval > MAX_LONG_BREAK_INTERVAL)
    ) {
      throw new Error(`longBreakInterval must be between 1 and ${MAX_LONG_BREAK_INTERVAL}.`);
    }
    if (args.soundVolume !== undefined && (!Number.isFinite(args.soundVolume) || args.soundVolume < 0 || args.soundVolume > 1)) {
      throw new Error("soundVolume must be between 0 and 1.");
    }

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

/**
 * Internal mutation for Convex Auth to link existing accounts (e.g. sondrelassen@gmail.com)
 * or create a new user document upon cryptographic verification of credentials.
 */
export const getOrCreateUserForAuth = internalMutation({
  args: {
    email: v.string(),
    sub: v.string(),
    name: v.string(),
    avatarUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const canonicalTokenId = `https://accounts.google.com|${args.sub}`;

    // 1. Search for existing user by email (links existing migrated account seamlessly)
    const existingByEmail = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .first();

    const safeAvatar =
      args.avatarUrl && args.avatarUrl.startsWith("https://") && args.avatarUrl.length <= 2048
        ? args.avatarUrl
        : undefined;

    if (existingByEmail) {
      const patchData: Record<string, unknown> = {};
      if (!existingByEmail.emailVerificationTime) {
        patchData.emailVerificationTime = Date.now();
      }
      if (!existingByEmail.displayName && args.name) {
        patchData.displayName = args.name;
      }
      if (!existingByEmail.name && args.name) {
        patchData.name = args.name;
      }
      if (safeAvatar && existingByEmail.avatarUrl !== safeAvatar) {
        patchData.avatarUrl = safeAvatar;
        patchData.image = safeAvatar;
      }
      if (
        !existingByEmail.tokenIdentifier ||
        existingByEmail.tokenIdentifier === args.sub
      ) {
        patchData.tokenIdentifier = canonicalTokenId;
      }
      if (Object.keys(patchData).length > 0) {
        await ctx.db.patch(existingByEmail._id, patchData);
      }
      return existingByEmail._id;
    }

    // 2. Search by canonical tokenIdentifier, then legacy bare sub
    const existingByToken =
      (await ctx.db
        .query("users")
        .withIndex("by_token", (q) => q.eq("tokenIdentifier", canonicalTokenId))
        .first()) ??
      (await ctx.db
        .query("users")
        .withIndex("by_token", (q) => q.eq("tokenIdentifier", args.sub))
        .first());

    if (existingByToken) {
      const patchData: Record<string, unknown> = {};
      if (existingByToken.email !== args.email) {
        patchData.email = args.email;
      }
      if (existingByToken.tokenIdentifier !== canonicalTokenId) {
        patchData.tokenIdentifier = canonicalTokenId;
      }
      if (!existingByToken.emailVerificationTime) {
        patchData.emailVerificationTime = Date.now();
      }
      if (safeAvatar && existingByToken.avatarUrl !== safeAvatar) {
        patchData.avatarUrl = safeAvatar;
        patchData.image = safeAvatar;
      }
      if (Object.keys(patchData).length > 0) {
        await ctx.db.patch(existingByToken._id, patchData);
      }
      return existingByToken._id;
    }

    // 3. Create new user if not found
    const now = new Date().toISOString();
    const newUserId = await ctx.db.insert("users", {
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
      settings: {
        ...DEFAULT_SETTINGS,
        updatedAt: now,
      },
      tags: DEFAULT_TAGS,
    });
    return newUserId;
  },
});

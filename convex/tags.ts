import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireUser, getAuthenticatedUser, DEFAULT_TAGS } from "./authHelper";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return DEFAULT_TAGS;
    return user.tags ?? DEFAULT_TAGS;
  },
});

export const create = mutation({
  args: {
    id: v.optional(v.string()),
    name: v.string(),
    color: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, true);
    const now = new Date().toISOString();

    const newTag = {
      id: args.id ?? `tag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: args.name.trim(),
      color: args.color.trim(),
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    };

    const currentTags = user.tags ?? DEFAULT_TAGS;
    const filtered = currentTags.filter((t) => t.id !== newTag.id);
    await ctx.db.patch(user._id, {
      tags: [...filtered, newTag],
    });

    return newTag;
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
    isArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const now = new Date().toISOString();
    const currentTags = user.tags ?? DEFAULT_TAGS;

    let found = false;
    let hasChanges = false;
    const updatedTags = currentTags.map((tag) => {
      if (tag.id === args.id) {
        found = true;
        const newName = args.name !== undefined ? args.name.trim() : tag.name;
        const newColor = args.color !== undefined ? args.color.trim() : tag.color;
        const newArchived = args.isArchived !== undefined ? args.isArchived : tag.isArchived;

        if (newName !== tag.name || newColor !== tag.color || newArchived !== tag.isArchived) {
          hasChanges = true;
          return {
            ...tag,
            name: newName,
            color: newColor,
            isArchived: newArchived,
            updatedAt: now,
          };
        }
      }
      return tag;
    });

    if (!found) {
      throw new Error(`Tag with ID "${args.id}" not found.`);
    }

    if (hasChanges) {
      await ctx.db.patch(user._id, {
        tags: updatedTags,
      });
    }

    return updatedTags.find((t) => t.id === args.id);
  },
});

export const remove = mutation({
  args: {
    id: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const currentTags = user.tags ?? DEFAULT_TAGS;
    const filtered = currentTags.filter((t) => t.id !== args.id);

    if (filtered.length !== currentTags.length) {
      await ctx.db.patch(user._id, {
        tags: filtered,
      });
    }

    // Clear orphaned tagId references in sessions, coffee_cups, and active_timers
    const sessionsWithTag = await ctx.db
      .query("sessions")
      .withIndex("by_user_completed", (q) => q.eq("userId", user._id))
      .filter((q) => q.eq(q.field("tagId"), args.id))
      .collect();
    for (const s of sessionsWithTag) {
      await ctx.db.patch(s._id, { tagId: undefined });
    }

    const cupsWithTag = await ctx.db
      .query("coffee_cups")
      .withIndex("by_user_date", (q) => q.eq("userId", user._id))
      .filter((q) => q.eq(q.field("tagId"), args.id))
      .collect();
    for (const c of cupsWithTag) {
      await ctx.db.patch(c._id, { tagId: undefined });
    }

    const activeTimer = await ctx.db
      .query("active_timers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (activeTimer && activeTimer.tagId === args.id) {
      await ctx.db.patch(activeTimer._id, { tagId: undefined });
    }

    return true;
  },
});

export const resetToDefaults = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const defaultTagIds = new Set(DEFAULT_TAGS.map((t) => t.id));

    await ctx.db.patch(user._id, {
      tags: DEFAULT_TAGS,
    });

    const userSessions = await ctx.db
      .query("sessions")
      .withIndex("by_user_completed", (q) => q.eq("userId", user._id))
      .collect();
    for (const s of userSessions) {
      if (s.tagId && !defaultTagIds.has(s.tagId)) {
        await ctx.db.patch(s._id, { tagId: undefined });
      }
    }

    const userCups = await ctx.db
      .query("coffee_cups")
      .withIndex("by_user_date", (q) => q.eq("userId", user._id))
      .collect();
    for (const c of userCups) {
      if (c.tagId && !defaultTagIds.has(c.tagId)) {
        await ctx.db.patch(c._id, { tagId: undefined });
      }
    }

    const activeTimer = await ctx.db
      .query("active_timers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (activeTimer && activeTimer.tagId && !defaultTagIds.has(activeTimer.tagId)) {
      await ctx.db.patch(activeTimer._id, { tagId: undefined });
    }

    return DEFAULT_TAGS;
  },
});

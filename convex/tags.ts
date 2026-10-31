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
    name: v.string(),
    color: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, true);
    const now = new Date().toISOString();

    const newTag = {
      id: `tag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: args.name.trim(),
      color: args.color.trim(),
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    };

    const currentTags = user.tags ?? DEFAULT_TAGS;
    await ctx.db.patch(user._id, {
      tags: [...currentTags, newTag],
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
    const currentTags = user.tags ?? DEFAULT_TAGS;
    const now = new Date().toISOString();

    const tagIndex = currentTags.findIndex((t) => t.id === args.id);
    if (tagIndex === -1) {
      throw new Error("Tag not found");
    }

    const updatedTag = {
      ...currentTags[tagIndex],
      ...(args.name !== undefined ? { name: args.name.trim() } : {}),
      ...(args.color !== undefined ? { color: args.color.trim() } : {}),
      ...(args.isArchived !== undefined ? { isArchived: args.isArchived } : {}),
      updatedAt: now,
    };

    const updatedTags = [...currentTags];
    updatedTags[tagIndex] = updatedTag;

    await ctx.db.patch(user._id, {
      tags: updatedTags,
    });

    return updatedTag;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const currentTags = user.tags ?? DEFAULT_TAGS;

    const filtered = currentTags.filter((t) => t.id !== args.id);
    await ctx.db.patch(user._id, {
      tags: filtered,
    });

    return true;
  },
});

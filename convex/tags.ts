import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireUser, getAuthenticatedUser } from "./authHelper";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return [];

    const tags = await ctx.db
      .query("tags")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    return tags.map((t) => ({
      id: t._id,
      name: t.name,
      color: t.color,
      isArchived: t.isArchived,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
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

    const tagId = await ctx.db.insert("tags", {
      userId: user._id,
      name: args.name.trim(),
      color: args.color.trim(),
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id: tagId,
      name: args.name.trim(),
      color: args.color.trim(),
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    };
  },
});

export const update = mutation({
  args: {
    id: v.id("tags"),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
    isArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const tag = await ctx.db.get(args.id);
    if (!tag || tag.userId !== user._id) {
      throw new Error("Tag not found or unauthorized");
    }

    const updates: Record<string, any> = {
      updatedAt: new Date().toISOString(),
    };
    if (args.name !== undefined) updates.name = args.name.trim();
    if (args.color !== undefined) updates.color = args.color.trim();
    if (args.isArchived !== undefined) updates.isArchived = args.isArchived;

    await ctx.db.patch(args.id, updates);
    return await ctx.db.get(args.id);
  },
});

export const remove = mutation({
  args: { id: v.id("tags") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const tag = await ctx.db.get(args.id);
    if (!tag || tag.userId !== user._id) {
      throw new Error("Tag not found or unauthorized");
    }

    await ctx.db.delete(args.id);
    return true;
  },
});

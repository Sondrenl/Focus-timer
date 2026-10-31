import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireUser, getAuthenticatedUser } from "./authHelper";

export const register = mutation({
  args: {
    deviceId: v.string(),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, true);
    const now = new Date().toISOString();

    const existing = await ctx.db
      .query("push_subscriptions")
      .withIndex("by_user_device", (q) =>
        q.eq("userId", user._id).eq("deviceId", args.deviceId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        endpoint: args.endpoint,
        p256dh: args.p256dh,
        auth: args.auth,
        userAgent: args.userAgent,
        updatedAt: now,
      });
      return existing._id;
    } else {
      return await ctx.db.insert("push_subscriptions", {
        userId: user._id,
        deviceId: args.deviceId,
        endpoint: args.endpoint,
        p256dh: args.p256dh,
        auth: args.auth,
        userAgent: args.userAgent,
        updatedAt: now,
      });
    }
  },
});

export const unregister = mutation({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const existing = await ctx.db
      .query("push_subscriptions")
      .withIndex("by_user_device", (q) =>
        q.eq("userId", user._id).eq("deviceId", args.deviceId)
      )
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
      return true;
    }
    return false;
  },
});

export const listSubscriptions = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return [];

    return await ctx.db
      .query("push_subscriptions")
      .withIndex("by_user_device", (q) => q.eq("userId", user._id))
      .collect();
  },
});

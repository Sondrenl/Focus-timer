import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireUser, getAuthenticatedUser } from "./authHelper";

export const MAX_PUSH_DEVICES_PER_USER = 10;

export const ALLOWED_PUSH_DOMAINS = [
  "fcm.googleapis.com",
  "push.apple.com",
  "updates.push.services.mozilla.com",
  "notify.windows.com",
  "web.push.apple.com",
];

function validateEndpoint(endpoint: string): void {
  if (!endpoint || endpoint.length > 2048) {
    throw new Error("Invalid push subscription endpoint length.");
  }
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:") {
      throw new Error();
    }
    const hostname = url.hostname.toLowerCase();
    // Block private/loopback/cloud metadata hostnames and IPs
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "127.0.0.1" ||
      hostname === "169.254.169.254" ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("172.16.")
    ) {
      throw new Error();
    }
    const isAllowed = ALLOWED_PUSH_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith("." + domain)
    );
    if (!isAllowed) {
      throw new Error();
    }
  } catch {
    throw new Error("Invalid push subscription endpoint: must be a valid HTTPS URL from an authorized push provider.");
  }
}

function validateDeviceId(deviceId: string): void {
  if (!deviceId || deviceId.length > 128 || !/^[a-zA-Z0-9_.-]+$/.test(deviceId)) {
    throw new Error("Invalid deviceId format.");
  }
}

function validatePushKey(key: string, name: string): void {
  if (!key || key.length > 256 || !/^[a-zA-Z0-9_/-]+=*$/.test(key)) {
    throw new Error(`Invalid ${name} format: must be valid base64 key.`);
  }
}

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
    validateDeviceId(args.deviceId);
    validateEndpoint(args.endpoint);
    validatePushKey(args.p256dh, "p256dh");
    validatePushKey(args.auth, "auth");

    const sanitizedUserAgent = args.userAgent ? args.userAgent.slice(0, 256) : undefined;
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
        userAgent: sanitizedUserAgent,
        updatedAt: now,
      });
      return existing._id;
    } else {
      // Enforce subscription quota: prune oldest device if quota reached
      const allSubscriptions = await ctx.db
        .query("push_subscriptions")
        .withIndex("by_user_device", (q) => q.eq("userId", user._id))
        .collect();

      if (allSubscriptions.length >= MAX_PUSH_DEVICES_PER_USER) {
        allSubscriptions.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
        const toPrune = allSubscriptions.slice(0, allSubscriptions.length - MAX_PUSH_DEVICES_PER_USER + 1);
        for (const sub of toPrune) {
          await ctx.db.delete(sub._id);
        }
      }

      return await ctx.db.insert("push_subscriptions", {
        userId: user._id,
        deviceId: args.deviceId,
        endpoint: args.endpoint,
        p256dh: args.p256dh,
        auth: args.auth,
        userAgent: sanitizedUserAgent,
        updatedAt: now,
      });
    }
  },
});

export const unregister = mutation({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    validateDeviceId(args.deviceId);

    const subscriptions = await ctx.db
      .query("push_subscriptions")
      .withIndex("by_user_device", (q) =>
        q.eq("userId", user._id).eq("deviceId", args.deviceId)
      )
      .collect();

    if (subscriptions.length > 0) {
      for (const sub of subscriptions) {
        await ctx.db.delete(sub._id);
      }
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
      .take(MAX_PUSH_DEVICES_PER_USER);
  },
});

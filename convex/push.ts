import { v } from "convex/values";
import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireUser } from "./authHelper";

export const MAX_PUSH_DEVICES_PER_USER = 10;

export function isSubscriptionMobile(sub: { isMobile?: boolean; userAgent?: string }): boolean {
  if (typeof sub.isMobile === "boolean") {
    return sub.isMobile;
  }
  return /Android|iPhone|iPad|iPod|Mobile/i.test(sub.userAgent || "");
}

export const ALLOWED_PUSH_DOMAINS = [
  "fcm.googleapis.com",
  "push.apple.com",
  "updates.push.services.mozilla.com",
  "notify.windows.com",
  "web.push.apple.com",
];

function decodeBase64UrlToBytes(b64u: string): Uint8Array {
  const b64 = b64u.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4 || 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function encodeBytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function deriveVapidPublicKeyFromPrivateJwk(rawPrivateJwk: string | undefined): string | null {
  if (!rawPrivateJwk) return null;
  try {
    const parsed = JSON.parse(rawPrivateJwk) as { kty?: string; crv?: string; x?: string; y?: string };
    if (parsed.kty === "EC" && parsed.crv === "P-256" && parsed.x && parsed.y) {
      const x = decodeBase64UrlToBytes(parsed.x);
      const y = decodeBase64UrlToBytes(parsed.y);
      if (x.length === 32 && y.length === 32) {
        const uncompressed = new Uint8Array(65);
        uncompressed[0] = 0x04;
        uncompressed.set(x, 1);
        uncompressed.set(y, 33);
        return encodeBytesToBase64Url(uncompressed);
      }
    }
  } catch {
    // Ignore invalid JSON
  }
  return null;
}

function validateEndpoint(endpoint: string): void {
  if (!endpoint || endpoint.length > 2048) {
    throw new Error("Invalid push subscription endpoint length.");
  }
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.port !== "" || url.username !== "" || url.password !== "") {
      throw new Error();
    }
    const hostname = url.hostname.toLowerCase();
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

export const getVapidPublicKey = query({
  args: {},
  handler: async () => {
    const explicit = process.env.VAPID_PUBLIC_KEY?.trim();
    if (explicit) return explicit;
    return deriveVapidPublicKeyFromPrivateJwk(process.env.VAPID_PRIVATE_KEY);
  },
});

export const register = mutation({
  args: {
    deviceId: v.string(),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    userAgent: v.optional(v.string()),
    isMobile: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, true);
    validateDeviceId(args.deviceId);
    validateEndpoint(args.endpoint);
    validatePushKey(args.p256dh, "p256dh");
    validatePushKey(args.auth, "auth");

    const sanitizedUserAgent = args.userAgent ? args.userAgent.slice(0, 256) : undefined;
    const now = new Date().toISOString();

    const sameEndpointSubs = await ctx.db
      .query("push_subscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .take(50);

    for (const doc of sameEndpointSubs) {
      if (doc.userId !== user._id) {
        await ctx.db.delete(doc._id);
      }
    }

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
        isMobile: args.isMobile ?? existing.isMobile,
        updatedAt: now,
      });
      return existing._id;
    } else {
      // Enforce subscription quota: prune oldest device if quota reached
      const allSubscriptions = await ctx.db
        .query("push_subscriptions")
        .withIndex("by_user_device", (q) => q.eq("userId", user._id))
        .take(50);

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
        isMobile: args.isMobile,
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
      .take(50);

    if (subscriptions.length > 0) {
      for (const sub of subscriptions) {
        await ctx.db.delete(sub._id);
      }
      return true;
    }
    return false;
  },
});

export const getPushDispatchContext = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      return { notificationsEnabled: false, subscriptions: [] };
    }

    const notificationsEnabled = user.settings?.notificationsEnabled ?? false;
    const subscriptions = await ctx.db
      .query("push_subscriptions")
      .withIndex("by_user_device", (q) => q.eq("userId", args.userId))
      .take(MAX_PUSH_DEVICES_PER_USER);

    return {
      notificationsEnabled,
      subscriptions,
    };
  },
});

export const deleteSubscriptionById = internalMutation({
  args: { id: v.id("push_subscriptions") },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (existing) {
      await ctx.db.delete(args.id);
      return true;
    }
    return false;
  },
});

export const scheduleTestPush = mutation({
  args: {
    delayMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const subs = await ctx.db
      .query("push_subscriptions")
      .withIndex("by_user_device", (q) => q.eq("userId", user._id))
      .take(MAX_PUSH_DEVICES_PER_USER);

    if (subs.length === 0) {
      return { scheduled: false, reason: "no_subscriptions" as const };
    }

    const clampedDelay = Math.max(0, Math.min(30_000, Math.round(args.delayMs ?? 5000)));
    await ctx.scheduler.runAfter(clampedDelay, internal.pushActions.sendTestPush, {
      userId: user._id,
      scheduledAtMs: Date.now(),
    });
    return { scheduled: true, delayMs: clampedDelay, deviceCount: subs.length };
  },
});



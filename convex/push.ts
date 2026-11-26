import { v } from "convex/values";
import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthenticatedUser, requireUser } from "./authHelper";

export const MAX_PUSH_DEVICES_PER_USER = 10;
const UPDATED_AT_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // Touch active devices daily so quota eviction never drops primary devices
const TEST_PUSH_RATE_LIMIT_MS = 5_000;

export const ALLOWED_PUSH_DOMAINS = [
  "fcm.googleapis.com",
  "push.apple.com",
  "push.services.mozilla.com",
  "updates.push.services.mozilla.com",
  "notify.windows.com",
  "web.push.apple.com",
];

function decodeBase64ToBytes(raw: string): Uint8Array {
  const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
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
      const x = decodeBase64ToBytes(parsed.x);
      const y = decodeBase64ToBytes(parsed.y);
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

export function isAllowedAppOrigin(url: URL): boolean {
  if (url.username !== "" || url.password !== "") return false;
  if (
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  ) {
    return true;
  }
  if (url.protocol !== "https:") return false;

  const hostname = url.hostname.toLowerCase();
  if (hostname === "focus-timer.sondrelassen.workers.dev" || hostname.endsWith(".sondrelassen.workers.dev")) {
    return true;
  }

  const configuredSiteUrl = process.env.SITE_URL?.trim();
  if (configuredSiteUrl) {
    try {
      const site = new URL(configuredSiteUrl);
      if (site.protocol === "https:" && site.origin === url.origin) {
        return true;
      }
    } catch {
      // Ignore malformed SITE_URL
    }
  }

  return false;
}

function sanitizeOrigin(rawOrigin: string | undefined): string | undefined {
  if (!rawOrigin) return undefined;
  const trimmed = rawOrigin.trim();
  if (!trimmed || trimmed.length > 256) return undefined;
  try {
    const url = new URL(trimmed);
    if (isAllowedAppOrigin(url)) {
      return url.origin;
    }
  } catch {
    // Ignore malformed origin
  }
  return undefined;
}

function validateDeviceId(deviceId: string): void {
  if (!deviceId || deviceId.length > 128 || !/^[a-zA-Z0-9_.-]+$/.test(deviceId)) {
    throw new Error("Invalid deviceId format.");
  }
}

function validateRotationTokenHash(hash: string | undefined): string | undefined {
  if (hash === undefined) return undefined;
  const normalized = hash.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("Invalid rotationTokenHash format.");
  }
  return normalized;
}

function validatePushKey(key: string, name: "p256dh" | "auth"): void {
  if (!key || key.length > 256 || !/^[a-zA-Z0-9+_/-]+=*$/.test(key)) {
    throw new Error(`Invalid ${name} format: must be valid base64 key.`);
  }
  let decoded: Uint8Array;
  try {
    decoded = decodeBase64ToBytes(key);
  } catch {
    throw new Error(`Invalid ${name} format: base64 decode failed.`);
  }
  if (name === "p256dh") {
    if (decoded.length !== 65 || decoded[0] !== 0x04) {
      throw new Error("Invalid p256dh key: must be a 65-byte uncompressed P-256 public key.");
    }
  } else if (decoded.length !== 16) {
    throw new Error("Invalid auth key: must be a 16-byte authentication secret.");
  }
}

export const getVapidPublicKey = query({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async () => {
    const derived = deriveVapidPublicKeyFromPrivateJwk(process.env.VAPID_PRIVATE_KEY);
    if (derived) return derived;
    const explicit = process.env.VAPID_PUBLIC_KEY?.trim();
    return explicit || null;
  },
});

export const getDeviceSubscriptionStatus = query({
  args: { deviceId: v.string() },
  returns: v.object({
    registered: v.boolean(),
    updatedAt: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) {
      return { registered: false, updatedAt: null };
    }
    if (!args.deviceId || args.deviceId.length > 128 || !/^[a-zA-Z0-9_.-]+$/.test(args.deviceId)) {
      return { registered: false, updatedAt: null };
    }
    const existing = await ctx.db
      .query("push_subscriptions")
      .withIndex("by_user_device", (q) =>
        q.eq("userId", user._id).eq("deviceId", args.deviceId)
      )
      .first();

    return {
      registered: Boolean(existing),
      updatedAt: existing?.updatedAt ?? null,
    };
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
    origin: v.optional(v.string()),
    rotationTokenHash: v.optional(v.string()),
  },
  returns: v.id("push_subscriptions"),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, true);
    validateDeviceId(args.deviceId);
    validateEndpoint(args.endpoint);
    validatePushKey(args.p256dh, "p256dh");
    validatePushKey(args.auth, "auth");
    const validatedRotationHash = validateRotationTokenHash(args.rotationTokenHash);

    const sanitizedUserAgent = args.userAgent ? args.userAgent.slice(0, 256) : undefined;
    const sanitizedOrigin = sanitizeOrigin(args.origin);
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();

    const sameEndpointSubs = await ctx.db
      .query("push_subscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .take(50);

    for (const doc of sameEndpointSubs) {
      if (doc.userId !== user._id || doc.deviceId !== args.deviceId) {
        await ctx.db.delete(doc._id);
      }
    }

    const existingList = await ctx.db
      .query("push_subscriptions")
      .withIndex("by_user_device", (q) =>
        q.eq("userId", user._id).eq("deviceId", args.deviceId)
      )
      .take(50);

    const existing = existingList[0];
    if (existingList.length > 1) {
      for (const duplicate of existingList.slice(1)) {
        await ctx.db.delete(duplicate._id);
      }
    }

    if (existing) {
      const nextIsMobile = args.isMobile ?? existing.isMobile;
      const nextOrigin = sanitizedOrigin ?? existing.origin;
      const nextRotationHash = validatedRotationHash ?? existing.rotationTokenHash;
      const unchanged =
        existing.endpoint === args.endpoint &&
        existing.p256dh === args.p256dh &&
        existing.auth === args.auth &&
        existing.userAgent === sanitizedUserAgent &&
        existing.isMobile === nextIsMobile &&
        existing.origin === nextOrigin &&
        existing.rotationTokenHash === nextRotationHash;

      const lastUpdatedMs = Date.parse(existing.updatedAt);
      const needsHeartbeatTouch =
        !Number.isFinite(lastUpdatedMs) || nowMs - lastUpdatedMs >= UPDATED_AT_REFRESH_INTERVAL_MS;

      if (unchanged && !needsHeartbeatTouch) {
        return existing._id;
      }

      if (unchanged && needsHeartbeatTouch) {
        await ctx.db.patch(existing._id, { updatedAt: now });
        return existing._id;
      }

      await ctx.db.patch(existing._id, {
        endpoint: args.endpoint,
        p256dh: args.p256dh,
        auth: args.auth,
        userAgent: sanitizedUserAgent,
        isMobile: nextIsMobile,
        origin: nextOrigin,
        rotationTokenHash: nextRotationHash,
        updatedAt: now,
      });
      return existing._id;
    } else {
      // Enforce subscription quota: prune least-recently-seen device if quota reached
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
        origin: sanitizedOrigin,
        rotationTokenHash: validatedRotationHash,
        updatedAt: now,
      });
    }
  },
});

export const rotateSubscription = internalMutation({
  args: {
    deviceId: v.string(),
    currentTokenHash: v.string(),
    nextTokenHash: v.optional(v.string()),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
  },
  returns: v.object({
    rotated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    validateDeviceId(args.deviceId);
    const currentHash = validateRotationTokenHash(args.currentTokenHash);
    if (!currentHash) {
      return { rotated: false };
    }
    const nextHash = validateRotationTokenHash(args.nextTokenHash);
    validateEndpoint(args.endpoint);
    validatePushKey(args.p256dh, "p256dh");
    validatePushKey(args.auth, "auth");

    const existing = await ctx.db
      .query("push_subscriptions")
      .withIndex("by_rotation_token_hash", (q) => q.eq("rotationTokenHash", currentHash))
      .first();

    if (!existing || existing.deviceId !== args.deviceId) {
      return { rotated: false };
    }

    const sameEndpointSubs = await ctx.db
      .query("push_subscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .take(50);

    for (const doc of sameEndpointSubs) {
      if (doc._id !== existing._id) {
        await ctx.db.delete(doc._id);
      }
    }

    await ctx.db.patch(existing._id, {
      endpoint: args.endpoint,
      p256dh: args.p256dh,
      auth: args.auth,
      rotationTokenHash: nextHash ?? existing.rotationTokenHash,
      updatedAt: new Date(Date.now()).toISOString(),
    });

    return { rotated: true };
  },
});

export const unregister = mutation({
  args: { deviceId: v.string() },
  returns: v.boolean(),
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
  returns: v.object({
    soundEnabled: v.boolean(),
    subscriptions: v.array(
      v.object({
        _id: v.id("push_subscriptions"),
        _creationTime: v.number(),
        userId: v.id("users"),
        deviceId: v.string(),
        endpoint: v.string(),
        p256dh: v.string(),
        auth: v.string(),
        userAgent: v.optional(v.string()),
        isMobile: v.optional(v.boolean()),
        origin: v.optional(v.string()),
        updatedAt: v.string(),
      })
    ),
  }),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      return { soundEnabled: true, subscriptions: [] };
    }

    const soundEnabled = user.settings?.soundEnabled ?? true;
    const rawSubscriptions = await ctx.db
      .query("push_subscriptions")
      .withIndex("by_user_device", (q) => q.eq("userId", args.userId))
      .take(MAX_PUSH_DEVICES_PER_USER);

    const subscriptions = rawSubscriptions.map(({ rotationTokenHash: _omit, ...rest }) => rest);

    return {
      soundEnabled,
      subscriptions,
    };
  },
});

export const deleteSubscriptionById = internalMutation({
  args: { id: v.id("push_subscriptions") },
  returns: v.boolean(),
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
  returns: v.union(
    v.object({
      scheduled: v.literal(false),
      reason: v.union(
        v.literal("no_subscriptions"),
        v.literal("rate_limited"),
        v.literal("missing_vapid_key")
      ),
    }),
    v.object({
      scheduled: v.literal(true),
      delayMs: v.number(),
      deviceCount: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const nowMs = Date.now();

    if (
      typeof user.lastTestPushAtMs === "number" &&
      nowMs - user.lastTestPushAtMs < TEST_PUSH_RATE_LIMIT_MS
    ) {
      return { scheduled: false as const, reason: "rate_limited" as const };
    }

    if (!process.env.VAPID_PRIVATE_KEY?.trim()) {
      return { scheduled: false as const, reason: "missing_vapid_key" as const };
    }

    const subs = await ctx.db
      .query("push_subscriptions")
      .withIndex("by_user_device", (q) => q.eq("userId", user._id))
      .take(MAX_PUSH_DEVICES_PER_USER);

    if (subs.length === 0) {
      return { scheduled: false as const, reason: "no_subscriptions" as const };
    }

    const rawDelay = args.delayMs !== undefined && Number.isFinite(args.delayMs) ? args.delayMs : 5000;
    const clampedDelay = Math.max(0, Math.min(30_000, Math.round(rawDelay)));
    await ctx.db.patch(user._id, { lastTestPushAtMs: nowMs });
    await ctx.scheduler.runAfter(clampedDelay, internal.pushActions.sendTestPush, {
      userId: user._id,
      scheduledAtMs: nowMs,
    });
    return { scheduled: true as const, delayMs: clampedDelay, deviceCount: subs.length };
  },
});




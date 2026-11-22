// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, it, expect, afterEach, vi } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import * as webpush from "web-push";

const modules = import.meta.glob("../convex/**/*.*s");

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function makeSyntheticSubKeys(seed = 0x11) {
  const p256Bytes = new Uint8Array(65);
  p256Bytes[0] = 0x04;
  p256Bytes.fill(seed, 1);
  const authBytes = new Uint8Array(16).fill((seed + 1) & 0xff);
  return {
    p256dh: toBase64Url(p256Bytes),
    auth: toBase64Url(authBytes),
  };
}

async function makeRealSubKeys() {
  const ecdh = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", ecdh.publicKey));
  const authBytes = crypto.getRandomValues(new Uint8Array(16));
  return {
    p256dh: toBase64Url(rawPub),
    auth: toBase64Url(authBytes),
  };
}

async function generateVapidJwk() {
  const kp = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  return await crypto.subtle.exportKey("jwk", kp.privateKey);
}

describe("Web Push Backend & Declarative Push", () => {
  const originalVapidPublic = process.env.VAPID_PUBLIC_KEY;
  const originalVapidPrivate = process.env.VAPID_PRIVATE_KEY;

  afterEach(() => {
    if (originalVapidPublic === undefined) {
      delete process.env.VAPID_PUBLIC_KEY;
    } else {
      process.env.VAPID_PUBLIC_KEY = originalVapidPublic;
    }
    if (originalVapidPrivate === undefined) {
      delete process.env.VAPID_PRIVATE_KEY;
    } else {
      process.env.VAPID_PRIVATE_KEY = originalVapidPrivate;
    }
  });

  async function createTestUser(t: ReturnType<typeof convexTest>) {
    const userId = await t.mutation(internal.users.getOrCreateUserForAuth, {
      email: "push@example.com",
      sub: "google-push-sub",
      name: "Push User",
    });
    const asUser = t.withIdentity({
      subject: `${userId}|push-session`,
      email: "push@example.com",
      name: "Push User",
    });
    return { userId, asUser };
  }

  it("derives uncompressed P-256 VAPID public key from VAPID_PRIVATE_KEY JWK", async () => {
    const jwk = await generateVapidJwk();
    delete process.env.VAPID_PUBLIC_KEY;
    process.env.VAPID_PRIVATE_KEY = JSON.stringify(jwk);

    const t = convexTest(schema, modules);
    const derivedKey = await t.query(api.push.getVapidPublicKey, {});
    expect(derivedKey).toBeTypeOf("string");
    expect(derivedKey!.length).toBeGreaterThan(80);

    // Explicit VAPID_PUBLIC_KEY overrides derivation if present
    process.env.VAPID_PUBLIC_KEY = "explicit-test-vapid-key";
    const explicitKey = await t.query(api.push.getVapidPublicKey, {});
    expect(explicitKey).toBe("explicit-test-vapid-key");
  });

  it("encrypts a high-urgency RFC 8291 aes128gcm + RFC 8292 vapid Declarative Web Push request via web-push", async () => {
    const vapidKeys = webpush.generateVAPIDKeys();
    const { p256dh, auth } = await makeRealSubKeys();

    const payload = JSON.stringify({
      web_push: 8030,
      mutable: false,
      notification: {
        title: "Pomodor — Focus session complete",
        body: "Your focus timer has finished. Time for a break.",
        navigate: "https://focus-timer.sondrelassen.workers.dev/",
        icon: "https://focus-timer.sondrelassen.workers.dev/icon-192.png",
        badge: "https://focus-timer.sondrelassen.workers.dev/badge-72.png",
        tag: "pomodor-session-run-test-123",
        silent: false,
        timestamp: Math.round(Date.now()),
      },
    });

    const req = webpush.generateRequestDetails(
      {
        endpoint: "https://web.push.apple.com/QTestAppleToken",
        keys: { p256dh, auth },
      },
      payload,
      {
        TTL: 180,
        urgency: "high",
        topic: "pomodor-alert",
        contentEncoding: "aes128gcm",
        vapidDetails: {
          subject: "mailto:notifications@pomodor.app",
          publicKey: vapidKeys.publicKey,
          privateKey: vapidKeys.privateKey,
        },
      }
    );

    expect(req.endpoint).toBe("https://web.push.apple.com/QTestAppleToken");
    expect(req.body).toBeInstanceOf(Buffer);
    expect(req.body!.byteLength).toBeGreaterThan(0);

    const headersLower = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), String(v)])
    );
    expect(headersLower["content-encoding"]).toBe("aes128gcm");
    expect(headersLower["authorization"]).toMatch(/^vapid t=/);
    expect(headersLower["urgency"]).toBe("high");
    expect(headersLower["topic"]).toBe("pomodor-alert");
    expect(headersLower["ttl"]).toBe("180");
    // Must NOT emit legacy aesgcm headers (which Apple APNs rejects)
    expect(headersLower["crypto-key"]).toBeUndefined();
    expect(headersLower["encryption"]).toBeUndefined();
  });

  it("validates p256dh/auth key lengths, accepts standard base64 with + and /, and enforces strict origin allowlist", async () => {
    const t = convexTest(schema, modules);
    const { userId, asUser } = await createTestUser(t);

    // Rejects short/corrupt p256dh
    await expect(
      asUser.mutation(api.push.register, {
        deviceId: "bad-key-1",
        endpoint: "https://fcm.googleapis.com/fcm/send/bad-key-1",
        p256dh: "BM6hZ_SHORT=",
        auth: makeSyntheticSubKeys().auth,
      })
    ).rejects.toThrow(/Invalid p256dh key/i);

    // Rejects 65-byte p256dh missing 0x04 uncompressed prefix
    const wrongPrefix = new Uint8Array(65).fill(0x02);
    await expect(
      asUser.mutation(api.push.register, {
        deviceId: "bad-key-2",
        endpoint: "https://fcm.googleapis.com/fcm/send/bad-key-2",
        p256dh: toBase64Url(wrongPrefix),
        auth: makeSyntheticSubKeys().auth,
      })
    ).rejects.toThrow(/Invalid p256dh key/i);

    // Rejects short auth key (valid base64, wrong length: 8 bytes instead of 16)
    await expect(
      asUser.mutation(api.push.register, {
        deviceId: "bad-key-3",
        endpoint: "https://fcm.googleapis.com/fcm/send/bad-key-3",
        p256dh: makeSyntheticSubKeys().p256dh,
        auth: "QUJDREVGR0g=",
      })
    ).rejects.toThrow(/Invalid auth key/i);

    // Accepts standard base64 keys containing '+' and '/'
    const plusSlashP256 = new Uint8Array(65);
    plusSlashP256[0] = 0x04;
    plusSlashP256.fill(0xfb, 1); // produces '+' and '/' in standard base64
    const plusSlashAuth = new Uint8Array(16).fill(0xff);
    const stdB64P256 = Buffer.from(plusSlashP256).toString("base64");
    const stdB64Auth = Buffer.from(plusSlashAuth).toString("base64");
    expect(stdB64P256).toMatch(/[+/]/);
    expect(stdB64Auth).toMatch(/[+/]/);

    const subId = await asUser.mutation(api.push.register, {
      deviceId: "android-pixel-1",
      endpoint: "https://fcm.googleapis.com/fcm/send/android-token",
      p256dh: stdB64P256,
      auth: stdB64Auth,
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/125.0 Mobile",
      isMobile: true,
      origin: "https://dev-focus-timer.sondrelassen.workers.dev/timer?foo=bar",
    });

    const deviceStatus = await asUser.query(api.push.getDeviceSubscriptionStatus, {
      deviceId: "android-pixel-1",
    });
    expect(deviceStatus.registered).toBe(true);
    expect(deviceStatus.updatedAt).toBeTypeOf("string");

    const ctxBefore = await t.query(internal.push.getPushDispatchContext, { userId });
    expect(ctxBefore.soundEnabled).toBe(true);
    expect(ctxBefore.subscriptions).toHaveLength(1);
    expect(ctxBefore.subscriptions[0].isMobile).toBe(true);
    expect(ctxBefore.subscriptions[0].origin).toBe(
      "https://dev-focus-timer.sondrelassen.workers.dev"
    );

    // Unauthorized HTTPS origins never overwrite an existing valid origin
    await asUser.mutation(api.push.register, {
      deviceId: "android-pixel-1",
      endpoint: "https://fcm.googleapis.com/fcm/send/android-token",
      p256dh: stdB64P256,
      auth: stdB64Auth,
      isMobile: true,
      origin: "https://evil.example.com",
    });
    const ctxSanitized = await t.query(internal.push.getPushDispatchContext, { userId });
    expect(ctxSanitized.subscriptions[0].origin).toBe(
      "https://dev-focus-timer.sondrelassen.workers.dev"
    );

    // Unauthorized origins are stripped on fresh registrations
    const badOriginSubId = await asUser.mutation(api.push.register, {
      deviceId: "bad-origin-device",
      endpoint: "https://fcm.googleapis.com/fcm/send/bad-origin-token",
      ...makeSyntheticSubKeys(0x21),
      origin: "https://evil.example.com",
    });
    const badOriginDoc = await t.run(async (ctx) => ctx.db.get(badOriginSubId));
    expect(badOriginDoc?.origin).toBeUndefined();
    await t.mutation(internal.push.deleteSubscriptionById, { id: badOriginSubId });

    // Pruning gone/expired subscription deletes it cleanly and reflects in getDeviceSubscriptionStatus
    const deleted = await t.mutation(internal.push.deleteSubscriptionById, { id: subId });
    expect(deleted).toBe(true);
    const statusAfter = await asUser.query(api.push.getDeviceSubscriptionStatus, {
      deviceId: "android-pixel-1",
    });
    expect(statusAfter).toEqual({ registered: false, updatedAt: null });
  });

  it("validates scheduleTestPush preconditions (VAPID key, subscriptions, 5s rate limit)", async () => {
    const t = convexTest(schema, modules);
    const { asUser } = await createTestUser(t);

    // Missing VAPID_PRIVATE_KEY fails fast
    delete process.env.VAPID_PRIVATE_KEY;
    const missingVapidRes = await asUser.mutation(api.push.scheduleTestPush, { delayMs: 5000 });
    expect(missingVapidRes).toEqual({ scheduled: false, reason: "missing_vapid_key" });

    // Configure VAPID_PRIVATE_KEY
    process.env.VAPID_PRIVATE_KEY = JSON.stringify(await generateVapidJwk());

    const noSubRes = await asUser.mutation(api.push.scheduleTestPush, { delayMs: 5000 });
    expect(noSubRes).toEqual({ scheduled: false, reason: "no_subscriptions" });

    await asUser.mutation(api.push.register, {
      deviceId: "android-1",
      endpoint: "https://fcm.googleapis.com/fcm/send/tok-1",
      ...makeSyntheticSubKeys(0x31),
      isMobile: true,
    });

    const scheduledRes = await asUser.mutation(api.push.scheduleTestPush, { delayMs: 5000 });
    expect(scheduledRes).toEqual({ scheduled: true, delayMs: 5000, deviceCount: 1 });

    // Immediate second call within 5s is rate-limited
    const rateLimitedRes = await asUser.mutation(api.push.scheduleTestPush, { delayMs: 5000 });
    expect(rateLimitedRes).toEqual({ scheduled: false, reason: "rate_limited" });
  });

  it("delivers RFC 8291 aes128gcm Web Push to all registered devices, retries 503 once, and prunes 403/410", async () => {
    process.env.VAPID_PRIVATE_KEY = JSON.stringify(await generateVapidJwk());

    const t = convexTest(schema, modules);
    const { userId, asUser } = await createTestUser(t);

    const mobileKeys = await makeRealSubKeys();
    const desktopKeys = await makeRealSubKeys();
    const deadKeys = await makeRealSubKeys();

    await asUser.mutation(api.push.register, {
      deviceId: "apple-iphone-1",
      endpoint: "https://web.push.apple.com/iphone-tok",
      ...mobileKeys,
      isMobile: true,
    });
    await asUser.mutation(api.push.register, {
      deviceId: "desktop-retry-1",
      endpoint: "https://fcm.googleapis.com/fcm/send/desktop-tok",
      ...desktopKeys,
      isMobile: false,
    });
    await asUser.mutation(api.push.register, {
      deviceId: "stale-vapid-1",
      endpoint: "https://web.push.apple.com/stale-vapid-tok",
      ...deadKeys,
      isMobile: true,
    });

    const deliveredHeadersByEndpoint = new Map<string, Record<string, string>>();
    let desktopAttempts = 0;

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = typeof input === "string" ? input : input.toString();
        const hdrs = Object.fromEntries(
          Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
            k.toLowerCase(),
            String(v),
          ])
        );
        deliveredHeadersByEndpoint.set(url, hdrs);

        if (url.includes("desktop-tok")) {
          desktopAttempts += 1;
          if (desktopAttempts === 1) {
            return new Response("Temporary outage", { status: 503 });
          }
          return new Response(null, { status: 201 });
        }
        if (url.includes("stale-vapid-tok")) {
          return new Response(JSON.stringify({ reason: "VapidPkHashMismatch" }), { status: 403 });
        }
        return new Response(null, { status: 201 });
      });

    try {
      const result = await t.action(internal.pushActions.sendTimerCompletionPush, {
        userId,
        sessionType: "WORK",
        timerRunId: "run-push-1",
        completedAtMs: Date.now(),
      });

      expect(result).toEqual({ sent: 2, pruned: 1 });
      expect(desktopAttempts).toBe(2);

      // Verify RFC 8291 aes128gcm & RFC 8292 vapid headers (no legacy Crypto-Key / Encryption)
      const appleHeaders = deliveredHeadersByEndpoint.get("https://web.push.apple.com/iphone-tok");
      expect(appleHeaders?.["content-encoding"]).toBe("aes128gcm");
      expect(appleHeaders?.["authorization"]).toMatch(/^vapid t=/);
      expect(appleHeaders?.["crypto-key"]).toBeUndefined();
      expect(appleHeaders?.["encryption"]).toBeUndefined();

      // Verify 403 VapidPkHashMismatch subscription was pruned
      const staleStatus = await asUser.query(api.push.getDeviceSubscriptionStatus, {
        deviceId: "stale-vapid-1",
      });
      expect(staleStatus.registered).toBe(false);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("schedules push based on per-device push_subscriptions (Decision 4A) even if account notificationsEnabled is false", async () => {
    const t = convexTest(schema, modules);
    const { userId, asUser } = await createTestUser(t);

    // Account setting is false, but this device has an active push subscription
    await asUser.mutation(api.users.updateSettings, { notificationsEnabled: false });
    await asUser.mutation(api.push.register, {
      deviceId: "iphone-sub-1",
      endpoint: "https://web.push.apple.com/iphone-per-device",
      ...makeSyntheticSubKeys(0x41),
      isMobile: true,
    });

    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("active_timers", {
        userId,
        sessionType: "SHORT_BREAK",
        status: "RUNNING",
        remainingSeconds: 300,
        totalSeconds: 300,
        targetEndTime: now - 500,
        currentCycle: 1,
        timerRunId: "run-break-1",
        updatedAtMs: now - 300_500,
      });
    });

    await asUser.mutation(api.timer.complete, {
      completedTimerRunId: "run-break-1",
      nextSessionType: "WORK",
      nextDurationSeconds: 1500,
      nextCurrentCycle: 2,
      autoStartNext: false,
    });

    const activeAfter = await asUser.query(api.timer.getActive, {});
    expect(activeAfter?.status).toBe("IDLE");
    expect(activeAfter?.sessionType).toBe("WORK");
    expect(activeAfter?.currentCycle).toBe(2);

    const sessions = await asUser.query(api.sessions.list, {});
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionType).toBe("SHORT_BREAK");

    const scheduled = await t.run(async (ctx) => {
      return await ctx.db.system.query("_scheduled_functions").collect();
    });
    expect(
      scheduled.some((job) => job.name.includes("sendTimerCompletionPush"))
    ).toBe(true);
  });

  it("does not prematurely complete a running timer or double-schedule when onTimerCompleted already transitioned to IDLE", async () => {
    const t = convexTest(schema, modules);
    const { userId, asUser } = await createTestUser(t);
    await asUser.mutation(api.push.register, {
      deviceId: "device-push-active",
      endpoint: "https://fcm.googleapis.com/fcm/send/active-tok",
      ...makeSyntheticSubKeys(0x51),
      isMobile: true,
    });

    // 1. Timer still has 60s left -> premature complete should be ignored
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("active_timers", {
        userId,
        sessionType: "SHORT_BREAK",
        status: "RUNNING",
        remainingSeconds: 60,
        totalSeconds: 300,
        targetEndTime: now + 60_000,
        currentCycle: 1,
        timerRunId: "run-break-early",
        updatedAtMs: now,
      });
    });

    await asUser.mutation(api.timer.complete, {
      completedTimerRunId: "run-break-early",
      nextSessionType: "WORK",
      nextDurationSeconds: 1500,
      nextCurrentCycle: 2,
      autoStartNext: false,
    });

    const stillRunning = await asUser.query(api.timer.getActive, {});
    expect(stillRunning?.status).toBe("RUNNING");
    expect(stillRunning?.sessionType).toBe("SHORT_BREAK");

    // 2. If server onTimerCompleted already transitioned to IDLE, calling complete afterwards is a safe no-op
    await t.mutation(internal.timer.onTimerCompleted, {
      userId,
      timerRunId: "run-break-early",
    });

    await asUser.mutation(api.timer.complete, {
      completedTimerRunId: "run-break-early",
      nextSessionType: "WORK",
      nextDurationSeconds: 1500,
      nextCurrentCycle: 2,
      autoStartNext: false,
    });

    const scheduledAfter = await t.run(async (ctx) => {
      return await ctx.db.system.query("_scheduled_functions").collect();
    });
    const pushJobs = scheduledAfter.filter((j) => j.name.includes("sendTimerCompletionPush"));
    expect(pushJobs).toHaveLength(1);
  });

  it("removes stale same-user endpoint rows when deviceId changes and returns soundEnabled in dispatch context", async () => {
    const t = convexTest(schema, modules);
    const { userId, asUser } = await createTestUser(t);
    const keys = makeSyntheticSubKeys(0x61);

    await asUser.mutation(api.push.register, {
      deviceId: "device-old",
      endpoint: "https://fcm.googleapis.com/fcm/send/shared-endpoint",
      ...keys,
      isMobile: true,
    });

    // Simulate localStorage clear creating a new deviceId for the same user & SW endpoint
    await asUser.mutation(api.push.register, {
      deviceId: "device-new",
      endpoint: "https://fcm.googleapis.com/fcm/send/shared-endpoint",
      ...keys,
      isMobile: true,
    });

    await asUser.mutation(api.users.updateSettings, {
      soundEnabled: false,
    });

    const ctx = await t.query(internal.push.getPushDispatchContext, { userId });
    expect(ctx.soundEnabled).toBe(false);
    expect(ctx.subscriptions).toHaveLength(1);
    expect(ctx.subscriptions[0].deviceId).toBe("device-new");
  });

  it("skips patching updatedAt within 24h when unchanged, but refreshes updatedAt after 24h to prevent active-device eviction", async () => {
    const t = convexTest(schema, modules);
    const { asUser } = await createTestUser(t);
    const keys = makeSyntheticSubKeys(0x71);

    const subArgs = {
      deviceId: "desktop-focus-1",
      endpoint: "https://fcm.googleapis.com/fcm/send/unchanged-tok",
      ...keys,
      userAgent: "Mozilla/5.0 Chrome/125.0",
      isMobile: false,
    };

    const firstId = await asUser.mutation(api.push.register, subArgs);
    const recentUpdatedAt = new Date(Date.now() - 60_000).toISOString();
    await t.run(async (ctx) => {
      await ctx.db.patch(firstId, { updatedAt: recentUpdatedAt });
    });

    // Re-registering identical subscription fields within 24h should skip ctx.db.patch
    const secondId = await asUser.mutation(api.push.register, subArgs);
    expect(secondId).toBe(firstId);
    const afterRecent = await t.run(async (ctx) => ctx.db.get(firstId));
    expect(afterRecent?.updatedAt).toBe(recentUpdatedAt);

    // Once >24h old, re-registering identical fields DOES touch updatedAt so active devices aren't evicted first
    const staleUpdatedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await t.run(async (ctx) => {
      await ctx.db.patch(firstId, { updatedAt: staleUpdatedAt });
    });
    await asUser.mutation(api.push.register, subArgs);
    const afterRefresh = await t.run(async (ctx) => ctx.db.get(firstId));
    expect(afterRefresh?.updatedAt).not.toBe(staleUpdatedAt);

    // Changing a field (e.g., auth key) immediately patches and refreshes updatedAt
    const updatedKeys = makeSyntheticSubKeys(0x75);
    await asUser.mutation(api.push.register, {
      ...subArgs,
      auth: updatedKeys.auth,
    });
    const afterChanged = await t.run(async (ctx) => ctx.db.get(firstId));
    expect(afterChanged?.auth).toBe(updatedKeys.auth);
  });

  it("cleans up duplicate (userId, deviceId) rows in api.push.register", async () => {
    const t = convexTest(schema, modules);
    const { userId, asUser } = await createTestUser(t);
    const keys = makeSyntheticSubKeys(0x81);

    await t.run(async (ctx) => {
      await ctx.db.insert("push_subscriptions", {
        userId,
        deviceId: "dup-device-1",
        endpoint: "https://fcm.googleapis.com/fcm/send/dup-tok-1",
        ...keys,
        isMobile: true,
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      await ctx.db.insert("push_subscriptions", {
        userId,
        deviceId: "dup-device-1",
        endpoint: "https://fcm.googleapis.com/fcm/send/dup-tok-2",
        ...keys,
        isMobile: true,
        updatedAt: "2026-01-02T00:00:00.000Z",
      });
    });

    await asUser.mutation(api.push.register, {
      deviceId: "dup-device-1",
      endpoint: "https://fcm.googleapis.com/fcm/send/dup-tok-1",
      ...keys,
      isMobile: true,
    });

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("push_subscriptions")
        .withIndex("by_user_device", (q) =>
          q.eq("userId", userId).eq("deviceId", "dup-device-1")
        )
        .collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].endpoint).toBe("https://fcm.googleapis.com/fcm/send/dup-tok-1");
  });

  it("does not schedule sendTimerCompletionPush when no device has an active push subscription", async () => {
    const t = convexTest(schema, modules);
    const { userId, asUser } = await createTestUser(t);

    // Even if account notificationsEnabled is true, having 0 push_subscriptions skips scheduling push
    await asUser.mutation(api.users.updateSettings, { notificationsEnabled: true });

    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("active_timers", {
        userId,
        sessionType: "WORK",
        status: "RUNNING",
        remainingSeconds: 1500,
        totalSeconds: 1500,
        targetEndTime: now - 500,
        currentCycle: 1,
        timerRunId: "run-no-sub-client",
        updatedAtMs: now - 1_500_500,
      });
    });

    await asUser.mutation(api.timer.complete, {
      completedTimerRunId: "run-no-sub-client",
      nextSessionType: "SHORT_BREAK",
      nextDurationSeconds: 300,
      nextCurrentCycle: 1,
      autoStartNext: false,
    });

    await t.run(async (ctx) => {
      const existing = await ctx.db
        .query("active_timers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first();
      await ctx.db.patch(existing!._id, {
        sessionType: "SHORT_BREAK",
        status: "RUNNING",
        remainingSeconds: 300,
        totalSeconds: 300,
        targetEndTime: Date.now() - 500,
        currentCycle: 1,
        timerRunId: "run-no-sub-server",
        updatedAtMs: Date.now() - 300_500,
      });
    });

    await t.mutation(internal.timer.onTimerCompleted, {
      userId,
      timerRunId: "run-no-sub-server",
    });

    const scheduled = await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").collect()
    );
    const pushJobs = scheduled.filter((job) => job.name.includes("sendTimerCompletionPush"));
    expect(pushJobs).toHaveLength(0);
  });
});

// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, it, expect, afterEach, vi } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { buildPushHTTPRequest } from "@pushforge/builder";

const modules = import.meta.glob("../convex/**/*.*s");

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
    const kp = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"]
    );
    const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
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

  it("encrypts a high-urgency Declarative Web Push (web_push: 8030) payload with @pushforge/builder", async () => {
    const vapidKp = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"]
    );
    const privateJWK = await crypto.subtle.exportKey("jwk", vapidKp.privateKey);

    const clientEcdh = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"]
    );
    const rawClientPub = new Uint8Array(
      await crypto.subtle.exportKey("raw", clientEcdh.publicKey)
    );
    const p256dh = btoa(String.fromCharCode(...rawClientPub))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const authBytes = crypto.getRandomValues(new Uint8Array(16));
    const auth = btoa(String.fromCharCode(...authBytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const req = await buildPushHTTPRequest({
      privateJWK,
      subscription: {
        endpoint: "https://fcm.googleapis.com/fcm/send/test-token",
        keys: { p256dh, auth },
      },
      message: {
        payload: {
          web_push: 8030,
          mutable: false,
          notification: {
            title: "Pomodor — Focus session complete",
            body: "Your focus timer has finished. Time for a break.",
            navigate: "https://focus-timer.sondrelassen.workers.dev/",
            icon: "https://focus-timer.sondrelassen.workers.dev/icon-192.png",
            tag: "pomodor-session-run-test-123",
            silent: false,
            timestamp: Date.now(),
          },
        },
        adminContact: "mailto:notifications@pomodor.app",
        options: {
          ttl: 600,
          urgency: "high",
          topic: "pomodor-alert",
        },
      },
    });

    expect(req.endpoint).toBe("https://fcm.googleapis.com/fcm/send/test-token");
    expect(req.body.byteLength).toBeGreaterThan(0);
    const getHeader = (name: string) =>
      req.headers instanceof Headers
        ? req.headers.get(name)
        : (req.headers as Record<string, string>)[name] ??
          (req.headers as Record<string, string>)[name.toLowerCase()];
    expect(getHeader("Urgency")).toBe("high");
    expect(getHeader("Topic")).toBe("pomodor-alert");
    expect(getHeader("Authorization")).toContain("vapid ");
  });

  it("sanitizes & stores origin, fetches dispatch context, and prunes stale subscriptions by ID", async () => {
    const t = convexTest(schema, modules);
    const { userId, asUser } = await createTestUser(t);

    const subId = await asUser.mutation(api.push.register, {
      deviceId: "android-pixel-1",
      endpoint: "https://fcm.googleapis.com/fcm/send/android-token",
      p256dh: "BM6hZ_VALID_KEY=",
      auth: "AUTHKEY==",
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/125.0 Mobile",
      isMobile: true,
      origin: "https://dev-focus-timer.sondrelassen.workers.dev/timer?foo=bar",
    });

    // Enable notifications as user does in settings
    await asUser.mutation(api.users.updateSettings, { notificationsEnabled: true });

    const ctxBefore = await t.query(internal.push.getPushDispatchContext, { userId });
    expect(ctxBefore.notificationsEnabled).toBe(true);
    expect(ctxBefore.subscriptions).toHaveLength(1);
    expect(ctxBefore.subscriptions[0].isMobile).toBe(true);
    expect(ctxBefore.subscriptions[0].origin).toBe(
      "https://dev-focus-timer.sondrelassen.workers.dev"
    );

    // Invalid non-https origins never overwrite an existing valid origin
    await asUser.mutation(api.push.register, {
      deviceId: "android-pixel-1",
      endpoint: "https://fcm.googleapis.com/fcm/send/android-token",
      p256dh: "BM6hZ_VALID_KEY=",
      auth: "AUTHKEY==",
      isMobile: true,
      origin: "http://evil.example.com",
    });
    const ctxSanitized = await t.query(internal.push.getPushDispatchContext, { userId });
    expect(ctxSanitized.subscriptions[0].origin).toBe(
      "https://dev-focus-timer.sondrelassen.workers.dev"
    );

    // Invalid non-https origins are stripped on fresh registrations
    const badOriginSubId = await asUser.mutation(api.push.register, {
      deviceId: "bad-origin-device",
      endpoint: "https://fcm.googleapis.com/fcm/send/bad-origin-token",
      p256dh: "BM6hZ_VALID_KEY=",
      auth: "AUTHKEY==",
      origin: "http://evil.example.com",
    });
    const badOriginDoc = await t.run(async (ctx) => ctx.db.get(badOriginSubId));
    expect(badOriginDoc?.origin).toBeUndefined();
    await t.mutation(internal.push.deleteSubscriptionById, { id: badOriginSubId });

    // Turning off notifications updates dispatch context
    await asUser.mutation(api.users.updateSettings, { notificationsEnabled: false });
    const ctxDisabled = await t.query(internal.push.getPushDispatchContext, { userId });
    expect(ctxDisabled.notificationsEnabled).toBe(false);

    // Pruning gone/expired subscription deletes it cleanly
    const deleted = await t.mutation(internal.push.deleteSubscriptionById, { id: subId });
    expect(deleted).toBe(true);
    const ctxAfter = await t.query(internal.push.getPushDispatchContext, { userId });
    expect(ctxAfter.subscriptions).toHaveLength(0);
  });

  it("validates scheduleTestPush preconditions and schedules delayed test push", async () => {
    const t = convexTest(schema, modules);
    const { asUser } = await createTestUser(t);

    const noSubRes = await asUser.mutation(api.push.scheduleTestPush, { delayMs: 5000 });
    expect(noSubRes).toEqual({ scheduled: false, reason: "no_subscriptions" });

    await asUser.mutation(api.push.register, {
      deviceId: "android-1",
      endpoint: "https://fcm.googleapis.com/fcm/send/tok-1",
      p256dh: "BM6hZ_VALID=",
      auth: "AUTHKEY==",
      isMobile: true,
    });

    const scheduledRes = await asUser.mutation(api.push.scheduleTestPush, { delayMs: 5000 });
    expect(scheduledRes).toEqual({ scheduled: true, delayMs: 5000, deviceCount: 1 });
  });

  it("delivers Web Push to both mobile and desktop subscriptions via sendTimerCompletionPush even when desktop is visible", async () => {
    const vapidKp = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"]
    );
    process.env.VAPID_PRIVATE_KEY = JSON.stringify(
      await crypto.subtle.exportKey("jwk", vapidKp.privateKey)
    );

    const makeSubKeys = async () => {
      const ecdh = await crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        true,
        ["deriveBits"]
      );
      const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", ecdh.publicKey));
      const p256dh = btoa(String.fromCharCode(...rawPub))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      const authBytes = crypto.getRandomValues(new Uint8Array(16));
      const auth = btoa(String.fromCharCode(...authBytes))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      return { p256dh, auth };
    };

    const t = convexTest(schema, modules);
    const { userId, asUser } = await createTestUser(t);
    await asUser.mutation(api.users.updateSettings, { notificationsEnabled: true });

    const mobileKeys = await makeSubKeys();
    const desktopKeys = await makeSubKeys();

    await asUser.mutation(api.push.register, {
      deviceId: "android-1",
      endpoint: "https://fcm.googleapis.com/fcm/send/android-tok",
      ...mobileKeys,
      isMobile: true,
    });
    await asUser.mutation(api.push.register, {
      deviceId: "desktop-1",
      endpoint: "https://fcm.googleapis.com/fcm/send/desktop-tok",
      ...desktopKeys,
      isMobile: false,
    });

    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("active_timers", {
        userId,
        sessionType: "WORK",
        status: "IDLE",
        remainingSeconds: 1500,
        totalSeconds: 1500,
        currentCycle: 1,
        updatedAtMs: now,
      });
    });

    const deliveredEndpoints: string[] = [];
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        deliveredEndpoints.push(typeof input === "string" ? input : input.toString());
        return new Response(null, { status: 201 });
      });

    try {
      const result = await t.action(internal.pushActions.sendTimerCompletionPush, {
        userId,
        sessionType: "WORK",
        timerRunId: "run-push-1",
        completedAtMs: now,
      });

      expect(result).toEqual({ sent: 2, pruned: 0 });
      expect(deliveredEndpoints).toContain("https://fcm.googleapis.com/fcm/send/android-tok");
      expect(deliveredEndpoints).toContain("https://fcm.googleapis.com/fcm/send/desktop-tok");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("records session, advances break->work, and schedules push when client api.timer.complete beats onTimerCompleted", async () => {
    const t = convexTest(schema, modules);
    const { userId, asUser } = await createTestUser(t);

    await asUser.mutation(api.users.updateSettings, { notificationsEnabled: true });

    // Insert an expired RUNNING break whose server onTimerCompleted hasn't run yet
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

    // Verify sendTimerCompletionPush was scheduled in _scheduled_functions
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
    await asUser.mutation(api.users.updateSettings, { notificationsEnabled: true });

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

    await asUser.mutation(api.push.register, {
      deviceId: "device-old",
      endpoint: "https://fcm.googleapis.com/fcm/send/shared-endpoint",
      p256dh: "BM6hZ_VALID_KEY=",
      auth: "AUTHKEY==",
      isMobile: true,
    });

    // Simulate localStorage clear creating a new deviceId for the same user & SW endpoint
    await asUser.mutation(api.push.register, {
      deviceId: "device-new",
      endpoint: "https://fcm.googleapis.com/fcm/send/shared-endpoint",
      p256dh: "BM6hZ_VALID_KEY=",
      auth: "AUTHKEY==",
      isMobile: true,
    });

    await asUser.mutation(api.users.updateSettings, {
      notificationsEnabled: true,
      soundEnabled: false,
    });

    const ctx = await t.query(internal.push.getPushDispatchContext, { userId });
    expect(ctx.soundEnabled).toBe(false);
    expect(ctx.subscriptions).toHaveLength(1);
    expect(ctx.subscriptions[0].deviceId).toBe("device-new");
  });

  it("skips patching updatedAt in api.push.register when subscription fields are unchanged", async () => {
    const t = convexTest(schema, modules);
    const { asUser } = await createTestUser(t);

    const subArgs = {
      deviceId: "desktop-focus-1",
      endpoint: "https://fcm.googleapis.com/fcm/send/unchanged-tok",
      p256dh: "BM6hZ_VALID_KEY=",
      auth: "AUTHKEY==",
      userAgent: "Mozilla/5.0 Chrome/125.0",
      isMobile: false,
    };

    const firstId = await asUser.mutation(api.push.register, subArgs);
    const sentinelUpdatedAt = "2026-01-01T00:00:00.000Z";
    await t.run(async (ctx) => {
      await ctx.db.patch(firstId, { updatedAt: sentinelUpdatedAt });
    });

    // Re-registering identical subscription fields should skip ctx.db.patch
    const secondId = await asUser.mutation(api.push.register, subArgs);
    expect(secondId).toBe(firstId);

    const afterUnchanged = await t.run(async (ctx) => ctx.db.get(firstId));
    expect(afterUnchanged?.updatedAt).toBe(sentinelUpdatedAt);

    // Changing a field (e.g., auth key) should patch and refresh updatedAt
    await asUser.mutation(api.push.register, {
      ...subArgs,
      auth: "UPDATED_AUTH==",
    });
    const afterChanged = await t.run(async (ctx) => ctx.db.get(firstId));
    expect(afterChanged?.auth).toBe("UPDATED_AUTH==");
    expect(afterChanged?.updatedAt).not.toBe(sentinelUpdatedAt);
  });

  it("cleans up duplicate (userId, deviceId) rows in api.push.register", async () => {
    const t = convexTest(schema, modules);
    const { userId, asUser } = await createTestUser(t);

    await t.run(async (ctx) => {
      await ctx.db.insert("push_subscriptions", {
        userId,
        deviceId: "dup-device-1",
        endpoint: "https://fcm.googleapis.com/fcm/send/dup-tok-1",
        p256dh: "BM6hZ_VALID_KEY=",
        auth: "AUTHKEY==",
        isMobile: true,
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      await ctx.db.insert("push_subscriptions", {
        userId,
        deviceId: "dup-device-1",
        endpoint: "https://fcm.googleapis.com/fcm/send/dup-tok-2",
        p256dh: "BM6hZ_VALID_KEY=",
        auth: "AUTHKEY==",
        isMobile: true,
        updatedAt: "2026-01-02T00:00:00.000Z",
      });
    });

    await asUser.mutation(api.push.register, {
      deviceId: "dup-device-1",
      endpoint: "https://fcm.googleapis.com/fcm/send/dup-tok-1",
      p256dh: "BM6hZ_VALID_KEY=",
      auth: "AUTHKEY==",
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

  it("does not schedule sendTimerCompletionPush when notificationsEnabled is undefined or false", async () => {
    const t = convexTest(schema, modules);
    const { userId, asUser } = await createTestUser(t);

    // 1. Missing/undefined user.settings (falls back to DEFAULT_SETTINGS) -> client api.timer.complete must not schedule push
    await t.run(async (ctx) => {
      await ctx.db.patch(userId, { settings: undefined });
      const now = Date.now();
      await ctx.db.insert("active_timers", {
        userId,
        sessionType: "WORK",
        status: "RUNNING",
        remainingSeconds: 1500,
        totalSeconds: 1500,
        targetEndTime: now - 500,
        currentCycle: 1,
        timerRunId: "run-notif-undef-client",
        updatedAtMs: now - 1_500_500,
      });
    });

    await asUser.mutation(api.timer.complete, {
      completedTimerRunId: "run-notif-undef-client",
      nextSessionType: "SHORT_BREAK",
      nextDurationSeconds: 300,
      nextCurrentCycle: 1,
      autoStartNext: false,
    });

    // 2. Undefined notificationsEnabled -> server internal.timer.onTimerCompleted must not schedule push
    await t.run(async (ctx) => {
      const existing = await ctx.db
        .query("active_timers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first();
      const now = Date.now();
      await ctx.db.patch(existing!._id, {
        sessionType: "SHORT_BREAK",
        status: "RUNNING",
        remainingSeconds: 300,
        totalSeconds: 300,
        targetEndTime: now - 500,
        currentCycle: 1,
        timerRunId: "run-notif-undef-server",
        updatedAtMs: now - 300_500,
      });
    });

    await t.mutation(internal.timer.onTimerCompleted, {
      userId,
      timerRunId: "run-notif-undef-server",
    });

    // 3. Explicit notificationsEnabled: false -> neither complete nor onTimerCompleted schedules push
    await asUser.mutation(api.users.updateSettings, { notificationsEnabled: false });

    await t.run(async (ctx) => {
      const existing = await ctx.db
        .query("active_timers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first();
      const now = Date.now();
      await ctx.db.patch(existing!._id, {
        sessionType: "WORK",
        status: "RUNNING",
        remainingSeconds: 1500,
        totalSeconds: 1500,
        targetEndTime: now - 500,
        currentCycle: 2,
        timerRunId: "run-notif-false-client",
        updatedAtMs: now - 1_500_500,
      });
    });

    await asUser.mutation(api.timer.complete, {
      completedTimerRunId: "run-notif-false-client",
      nextSessionType: "SHORT_BREAK",
      nextDurationSeconds: 300,
      nextCurrentCycle: 2,
      autoStartNext: false,
    });

    await t.run(async (ctx) => {
      const existing = await ctx.db
        .query("active_timers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first();
      const now = Date.now();
      await ctx.db.patch(existing!._id, {
        sessionType: "SHORT_BREAK",
        status: "RUNNING",
        remainingSeconds: 300,
        totalSeconds: 300,
        targetEndTime: now - 500,
        currentCycle: 2,
        timerRunId: "run-notif-false-server",
        updatedAtMs: now - 300_500,
      });
    });

    await t.mutation(internal.timer.onTimerCompleted, {
      userId,
      timerRunId: "run-notif-false-server",
    });

    const scheduled = await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").collect()
    );
    const pushJobs = scheduled.filter((job) => job.name.includes("sendTimerCompletionPush"));
    expect(pushJobs).toHaveLength(0);
  });
});

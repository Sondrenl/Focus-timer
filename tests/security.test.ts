// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.*s");

describe("Security Hardening & Input Validation", () => {
  async function createAuthenticatedTestUser(t: ReturnType<typeof convexTest>) {
    const userId = await t.mutation(internal.users.getOrCreateUserForAuth, {
      email: "secure-user@example.com",
      sub: "google-secure-sub",
      name: "Security Tester",
    });
    const asUser = t.withIdentity({
      subject: `${userId}|session-sec`,
      email: "secure-user@example.com",
      name: "Security Tester",
    });
    return { userId, asUser };
  }

  it("sanitizes invalid or malicious tag color values to fallback hex", async () => {
    const t = convexTest(schema, modules);
    const { asUser } = await createAuthenticatedTestUser(t);

    const tag = await asUser.mutation(api.tags.create, {
      name: "Research",
      color: "javascript:alert(1)",
    });

    expect(tag.color).toBe("#6B7280");
  });

  it("rejects empty tag names, oversized tag names, and malformed tag IDs", async () => {
    const t = convexTest(schema, modules);
    const { asUser } = await createAuthenticatedTestUser(t);

    await expect(
      asUser.mutation(api.tags.create, {
        name: "   ",
        color: "#3B82F6",
      })
    ).rejects.toThrow("Tag name cannot be empty.");

    await expect(
      asUser.mutation(api.tags.create, {
        name: "A".repeat(51),
        color: "#3B82F6",
      })
    ).rejects.toThrow("Tag name cannot exceed 50 characters.");

    await expect(
      asUser.mutation(api.tags.create, {
        id: "invalid tag id with spaces!",
        name: "Valid Name",
        color: "#3B82F6",
      })
    ).rejects.toThrow("Invalid tag id format.");
  });

  it("rejects negative or excessive durationSeconds in sessions.record", async () => {
    const t = convexTest(schema, modules);
    const { asUser } = await createAuthenticatedTestUser(t);

    await expect(
      asUser.mutation(api.sessions.record, {
        sessionType: "WORK",
        durationSeconds: -300,
      })
    ).rejects.toThrow("Invalid durationSeconds");

    await expect(
      asUser.mutation(api.sessions.record, {
        sessionType: "WORK",
        durationSeconds: 99999999,
      })
    ).rejects.toThrow("Invalid durationSeconds");
  });

  it("rejects future completedAt timestamps beyond 24h", async () => {
    const t = convexTest(schema, modules);
    const { asUser } = await createAuthenticatedTestUser(t);

    const futureDate = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
    await expect(
      asUser.mutation(api.sessions.record, {
        sessionType: "WORK",
        durationSeconds: 1500,
        completedAt: futureDate,
      })
    ).rejects.toThrow("completedAt timestamp cannot be in the future.");
  });

  it("validates date format and enforces daily coffee limits", async () => {
    const t = convexTest(schema, modules);
    const { asUser } = await createAuthenticatedTestUser(t);

    await expect(
      asUser.mutation(api.coffee.addCup, {
        date: "invalid-date-format",
      })
    ).rejects.toThrow("Invalid date format: must be YYYY-MM-DD.");

    // Fill up to 50 cups
    for (let i = 0; i < 50; i++) {
      await asUser.mutation(api.coffee.addCup, {
        date: "2026-03-20",
        createdAt: `2026-03-20T10:${i.toString().padStart(2, "0")}:00.000Z`,
      });
    }

    // 51st cup should be rejected
    await expect(
      asUser.mutation(api.coffee.addCup, {
        date: "2026-03-20",
      })
    ).rejects.toThrow("Maximum limit of 50 coffee cups per day reached.");
  });

  it("prevents cross-table arbitrary document deletion in coffee.removeCup", async () => {
    const t = convexTest(schema, modules);
    const { asUser } = await createAuthenticatedTestUser(t);

    // Create a real session
    const session = await asUser.mutation(api.sessions.record, {
      sessionType: "WORK",
      durationSeconds: 1500,
      completedAt: "2026-03-20T12:00:00.000Z",
    });

    // Attempt to pass the session ID to coffee.removeCup (IDOR / cross-table deletion attack)
    const result = await asUser.mutation(api.coffee.removeCup, {
      id: session.id,
    });

    expect(result).toBe(false);

    // Verify session was NOT deleted from sessions table
    const sessions = await asUser.query(api.sessions.list, {});
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(session.id);
  });

  it("validates profile and settings bounds", async () => {
    const t = convexTest(schema, modules);
    const { asUser } = await createAuthenticatedTestUser(t);

    await expect(
      asUser.mutation(api.users.updateProfile, {
        dailyGoalMinutes: -10,
      })
    ).rejects.toThrow("Daily goal minutes must be between 1 and 1440.");

    await expect(
      asUser.mutation(api.users.updateProfile, {
        displayName: "X".repeat(101),
      })
    ).rejects.toThrow("Display name cannot exceed 100 characters.");

    await expect(
      asUser.mutation(api.users.updateSettings, {
        workDurationMinutes: 500,
      })
    ).rejects.toThrow("workDurationMinutes must be between 0.01 and 360.");

    // Fractional sub-minute duration (0.5 min = 30s) is allowed consistently with the UI
    await asUser.mutation(api.users.updateSettings, {
      workDurationMinutes: 0.5,
    });

    await expect(
      asUser.mutation(api.users.updateSettings, {
        soundVolume: 1.5,
      })
    ).rejects.toThrow("soundVolume must be between 0 and 1.");
  });

  it("validates timer input parameters in timer.start and timer.reset", async () => {
    const t = convexTest(schema, modules);
    const { asUser } = await createAuthenticatedTestUser(t);

    await expect(
      asUser.mutation(api.timer.start, {
        sessionType: "WORK",
        durationSeconds: 0,
        currentCycle: 1,
        timerRunId: "test-run",
      })
    ).rejects.toThrow("durationSeconds must be between 1 and 86400.");

    await expect(
      asUser.mutation(api.timer.start, {
        sessionType: "WORK",
        durationSeconds: 1500,
        currentCycle: 1,
        timerRunId: "invalid run id with spaces!",
      })
    ).rejects.toThrow("Invalid timerRunId format.");

    await expect(
      asUser.mutation(api.timer.reset, {
        sessionType: "WORK",
        durationSeconds: 1500,
        currentCycle: 101,
      })
    ).rejects.toThrow("currentCycle must be between 1 and 100.");
  });

  it("validates push subscription endpoints against SSRF and non-HTTPS schemes", async () => {
    const t = convexTest(schema, modules);
    const { asUser } = await createAuthenticatedTestUser(t);

    const makeValidPushKeys = (seed: number) => {
      const p256Bytes = new Uint8Array(65);
      p256Bytes[0] = 0x04;
      p256Bytes.fill(seed, 1);
      const authBytes = new Uint8Array(16).fill(seed + 1);
      const toB64Url = (bytes: Uint8Array) =>
        btoa(String.fromCharCode(...bytes))
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");
      return { p256dh: toB64Url(p256Bytes), auth: toB64Url(authBytes) };
    };
    const { p256dh: validP256dh, auth: validAuth } = makeValidPushKeys(0x11);

    await expect(
      asUser.mutation(api.push.register, {
        deviceId: "device-1",
        endpoint: "http://169.254.169.254/latest/meta-data/",
        p256dh: validP256dh,
        auth: validAuth,
      })
    ).rejects.toThrow("Invalid push subscription endpoint: must be a valid HTTPS URL from an authorized push provider.");

    await expect(
      asUser.mutation(api.push.register, {
        deviceId: "device-1",
        endpoint: "https://169.254.169.254/latest/meta-data/",
        p256dh: validP256dh,
        auth: validAuth,
      })
    ).rejects.toThrow("Invalid push subscription endpoint: must be a valid HTTPS URL from an authorized push provider.");

    await expect(
      asUser.mutation(api.push.register, {
        deviceId: "device-1",
        endpoint: "javascript:alert(1)",
        p256dh: validP256dh,
        auth: validAuth,
      })
    ).rejects.toThrow("Invalid push subscription endpoint: must be a valid HTTPS URL from an authorized push provider.");

    // Valid HTTPS endpoint from allowed provider succeeds
    const regId = await asUser.mutation(api.push.register, {
      deviceId: "device-1",
      endpoint: "https://fcm.googleapis.com/fcm/send/sample-token",
      p256dh: validP256dh,
      auth: validAuth,
    });
    expect(regId).toBeDefined();
  });

  it("enforces push subscription quota and prunes oldest devices when exceeding quota", async () => {
    const t = convexTest(schema, modules);
    const { userId, asUser } = await createAuthenticatedTestUser(t);
    const p256Bytes = new Uint8Array(65);
    p256Bytes[0] = 0x04;
    p256Bytes.fill(0x33, 1);
    const validP256dh = btoa(String.fromCharCode(...p256Bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const validAuth = btoa(String.fromCharCode(...new Uint8Array(16).fill(0x44))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    // Register 11 devices
    for (let i = 1; i <= 11; i++) {
      await asUser.mutation(api.push.register, {
        deviceId: `device-${i}`,
        endpoint: `https://fcm.googleapis.com/fcm/send/token-${i}`,
        p256dh: validP256dh,
        auth: validAuth,
      });
    }

    const subs = await t.run(async (ctx) => {
      return await ctx.db
        .query("push_subscriptions")
        .withIndex("by_user_device", (q) => q.eq("userId", userId))
        .collect();
    });
    expect(subs.length).toBeLessThanOrEqual(10);
    // Device 1 should have been pruned
    expect(subs.some((s) => s.deviceId === "device-1")).toBe(false);
    expect(subs.some((s) => s.deviceId === "device-11")).toBe(true);
  });

  it("removes another user's push subscription when a different account registers the same endpoint", async () => {
    const t = convexTest(schema, modules);
    const { userId: userAId, asUser: asUserA } = await createAuthenticatedTestUser(t);
    const p256Bytes = new Uint8Array(65);
    p256Bytes[0] = 0x04;
    p256Bytes.fill(0x55, 1);
    const validP256dh = btoa(String.fromCharCode(...p256Bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const validAuth = btoa(String.fromCharCode(...new Uint8Array(16).fill(0x66))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const userBId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        tokenIdentifier: "test-provider|user-b",
        email: "user-b@example.com",
        displayName: "User B",
        dailyGoalMinutes: 120,
      });
    });
    const asUserB = t.withIdentity({
      subject: `${userBId}|session-b`,
      email: "user-b@example.com",
      name: "User B",
    });

    const sharedEndpoint = "https://fcm.googleapis.com/fcm/send/shared-browser-endpoint";

    await asUserA.mutation(api.push.register, {
      deviceId: "shared-browser-device",
      endpoint: sharedEndpoint,
      p256dh: validP256dh,
      auth: validAuth,
    });

    await asUserB.mutation(api.push.register, {
      deviceId: "shared-browser-device",
      endpoint: sharedEndpoint,
      p256dh: validP256dh,
      auth: validAuth,
    });

    const subsForEndpoint = await t.run(async (ctx) => {
      return await ctx.db
        .query("push_subscriptions")
        .withIndex("by_endpoint", (q) => q.eq("endpoint", sharedEndpoint))
        .collect();
    });

    expect(subsForEndpoint).toHaveLength(1);
    expect(subsForEndpoint[0].userId).toBe(userBId);
    expect(subsForEndpoint[0].userId).not.toBe(userAId);
  });

  it("rejects oversized backup imports", async () => {
    const t = convexTest(schema, modules);
    const { asUser } = await createAuthenticatedTestUser(t);

    const excessiveTags = Array.from({ length: 101 }, (_, i) => ({
      name: `Tag ${i}`,
      color: "#3B82F6",
    }));

    await expect(
      asUser.mutation(api.migrations.importBackup, {
        mode: "merge",
        tags: excessiveTags,
        sessions: [],
      })
    ).rejects.toThrow("Cannot import more than 100 tags.");
  });

  it("cleans up abandoned RUNNING timers via cleanupStaleTimers", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await createAuthenticatedTestUser(t);

    const now = Date.now();
    // Insert an abandoned RUNNING timer whose targetEndTime was 2 hours ago
    await t.run(async (ctx) => {
      await ctx.db.insert("active_timers", {
        userId,
        sessionType: "WORK",
        status: "RUNNING",
        remainingSeconds: 0,
        totalSeconds: 1500,
        targetEndTime: now - 2 * 3600 * 1000,
        currentCycle: 1,
        updatedAtMs: now - 2 * 3600 * 1000,
      });
    });

    const res = await t.mutation(internal.timer.cleanupStaleTimers, {});
    expect(res.cleanedCount).toBeGreaterThanOrEqual(1);

    const timer = await t.run(async (ctx) => {
      return await ctx.db
        .query("active_timers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first();
    });

    expect(timer?.status).toBe("IDLE");
    expect(timer?.targetEndTime).toBeUndefined();
  });

  it("guards query limits against NaN/floats and enforces integer-only profile/setting fields", async () => {
    const t = convexTest(schema, modules);
    const { asUser } = await createAuthenticatedTestUser(t);

    // NaN and fractional limits must not crash .take()
    expect(await asUser.query(api.sessions.list, { limit: Number.NaN })).toEqual([]);
    expect(await asUser.query(api.sessions.list, { limit: 1.7 })).toEqual([]);
    expect(await asUser.query(api.coffee.list, { limit: Number.NaN })).toEqual([]);
    expect(await asUser.query(api.coffee.list, { limit: 1.7 })).toEqual([]);

    // Non-integer values must be rejected for integer-only fields
    await expect(
      asUser.mutation(api.users.updateProfile, { dailyGoalMinutes: 120.5 })
    ).rejects.toThrow("Daily goal minutes must be an integer.");

    await expect(
      asUser.mutation(api.users.updateSettings, { longBreakInterval: 2.5 })
    ).rejects.toThrow("longBreakInterval must be an integer.");
  });
});

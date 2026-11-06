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
    ).rejects.toThrow("workDurationMinutes must be between 1 and 360.");

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

    await expect(
      asUser.mutation(api.push.register, {
        deviceId: "device-1",
        endpoint: "http://169.254.169.254/latest/meta-data/",
        p256dh: "BM6hZ/VALID=",
        auth: "AUTHKEY==",
      })
    ).rejects.toThrow("Invalid push subscription endpoint: must be a valid HTTPS URL.");

    await expect(
      asUser.mutation(api.push.register, {
        deviceId: "device-1",
        endpoint: "javascript:alert(1)",
        p256dh: "BM6hZ/VALID=",
        auth: "AUTHKEY==",
      })
    ).rejects.toThrow("Invalid push subscription endpoint: must be a valid HTTPS URL.");

    // Valid HTTPS endpoint succeeds
    const regId = await asUser.mutation(api.push.register, {
      deviceId: "device-1",
      endpoint: "https://fcm.googleapis.com/fcm/send/sample-token",
      p256dh: "BM6hZ/VALID=",
      auth: "AUTHKEY==",
    });
    expect(regId).toBeDefined();
  });

  it("enforces push subscription quota and prunes oldest devices when exceeding quota", async () => {
    const t = convexTest(schema, modules);
    const { asUser } = await createAuthenticatedTestUser(t);

    // Register 11 devices
    for (let i = 1; i <= 11; i++) {
      await asUser.mutation(api.push.register, {
        deviceId: `device-${i}`,
        endpoint: `https://fcm.googleapis.com/fcm/send/token-${i}`,
        p256dh: "BM6hZ/VALID=",
        auth: "AUTHKEY==",
      });
    }

    const subs = await asUser.query(api.push.listSubscriptions, {});
    expect(subs.length).toBeLessThanOrEqual(10);
    // Device 1 should have been pruned
    expect(subs.some((s) => s.deviceId === "device-1")).toBe(false);
    expect(subs.some((s) => s.deviceId === "device-11")).toBe(true);
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
});

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

  it("rejects empty tag names and oversized tag names", async () => {
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
      asUser.mutation(api.timer.reset, {
        sessionType: "WORK",
        durationSeconds: 1500,
        currentCycle: 101,
      })
    ).rejects.toThrow("currentCycle must be between 1 and 100.");
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

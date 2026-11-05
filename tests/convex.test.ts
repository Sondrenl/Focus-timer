// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.*s");

describe("Convex Backend Integration Tests (convex-test)", () => {
  async function createAuthenticatedTestUser(t: ReturnType<typeof convexTest>) {
    const userId = await t.mutation(internal.users.getOrCreateUserForAuth, {
      email: "user@example.com",
      sub: "google-sub-123",
      name: "Test Practitioner",
    });
    const asUser = t.withIdentity({
      subject: `${userId}|session-1`,
      email: "user@example.com",
      name: "Test Practitioner",
    });
    return { userId, asUser };
  }

  it("initializes user profile, settings, and default tags on sign-in", async () => {
    const t = convexTest(schema, modules);
    const { asUser } = await createAuthenticatedTestUser(t);

    const userState = await asUser.query(api.users.current, {});
    expect(userState).not.toBeNull();
    expect(userState?.displayName).toBe("Test Practitioner");
    expect(userState?.settings.workDurationMinutes).toBe(25);
    expect(userState?.tags.length).toBeGreaterThanOrEqual(4);
    expect(userState?.tags.some((tag) => tag.id === "tag-study")).toBe(true);
  });

  it("deduplicates sessions within ±45s of same sessionType and durationSeconds", async () => {
    const t = convexTest(schema, modules);
    const { asUser } = await createAuthenticatedTestUser(t);

    const first = await asUser.mutation(api.sessions.record, {
      tagId: "tag-study",
      sessionType: "WORK",
      durationSeconds: 1500,
      completedAt: "2026-03-10T10:00:00.000Z",
    });

    // Duplicate 10 seconds later from another tab/device
    const second = await asUser.mutation(api.sessions.record, {
      tagId: "tag-study",
      sessionType: "WORK",
      durationSeconds: 1500,
      completedAt: "2026-03-10T10:00:10.000Z",
    });

    expect(second.id).toBe(first.id);

    const list = await asUser.query(api.sessions.list, {});
    expect(list).toHaveLength(1);
  });

  it("clears custom tagId references across sessions, coffee_cups, and active_timers on tags.resetToDefaults (Option A)", async () => {
    const t = convexTest(schema, modules);
    const { userId, asUser } = await createAuthenticatedTestUser(t);

    // Create a custom tag
    const customTag = await asUser.mutation(api.tags.create, {
      name: "Deep Research",
      color: "#8B5CF6",
    });

    // Record a session with the custom tag and one with a default tag
    await asUser.mutation(api.sessions.record, {
      tagId: customTag.id,
      sessionType: "WORK",
      durationSeconds: 1500,
      completedAt: "2026-03-10T09:00:00.000Z",
    });
    await asUser.mutation(api.sessions.record, {
      tagId: "tag-study",
      sessionType: "WORK",
      durationSeconds: 1500,
      completedAt: "2026-03-10T11:00:00.000Z",
    });

    // Add a coffee cup with the custom tag
    await asUser.mutation(api.coffee.addCup, {
      tagId: customTag.id,
      date: "2026-03-10",
    });

    // Set active timer with the custom tag
    await t.run(async (ctx) => {
      await ctx.db.insert("active_timers", {
        userId,
        sessionType: "WORK",
        status: "IDLE",
        remainingSeconds: 1500,
        totalSeconds: 1500,
        currentCycle: 1,
        tagId: customTag.id,
        updatedAtMs: Date.now(),
      });
    });

    // Reset tags to defaults
    await asUser.mutation(api.tags.resetToDefaults, {});

    const sessions = await asUser.query(api.sessions.list, {});
    const customSession = sessions.find((s) => s.completedAt === "2026-03-10T09:00:00.000Z");
    const defaultSession = sessions.find((s) => s.completedAt === "2026-03-10T11:00:00.000Z");

    expect(customSession?.tagId).toBeNull();
    expect(defaultSession?.tagId).toBe("tag-study");

    const coffeeCups = await asUser.query(api.coffee.list, {});
    expect(coffeeCups).toHaveLength(1);
    expect(coffeeCups[0].tagId).toBeNull();

    const activeTimer = await asUser.query(api.timer.getActive, {});
    expect(activeTimer?.tagId).toBeUndefined();
  });

  it("advances active_timers to the next interval in IDLE status when onTimerCompleted fires (Option A)", async () => {
    const t = convexTest(schema, modules);
    const { userId, asUser } = await createAuthenticatedTestUser(t);

    const targetEndTime = Date.now() + 1500_000;
    await t.run(async (ctx) => {
      await ctx.db.insert("active_timers", {
        userId,
        sessionType: "WORK",
        status: "RUNNING",
        remainingSeconds: 1500,
        totalSeconds: 1500,
        targetEndTime,
        currentCycle: 1,
        tagId: "tag-study",
        timerRunId: "run-1",
        updatedAtMs: Date.now(),
      });
    });

    // Simulate scheduled server completion of Cycle 1 WORK -> should advance to Cycle 1 SHORT_BREAK in IDLE
    await t.mutation(internal.timer.onTimerCompleted, {
      userId,
      timerRunId: "run-1",
    });

    const activeAfterWork = await asUser.query(api.timer.getActive, {});
    expect(activeAfterWork?.status).toBe("IDLE");
    expect(activeAfterWork?.sessionType).toBe("SHORT_BREAK");
    expect(activeAfterWork?.currentCycle).toBe(1);
    expect(activeAfterWork?.remainingSeconds).toBe(5 * 60);

    const sessions = await asUser.query(api.sessions.list, {});
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionType).toBe("WORK");
    expect(sessions[0].durationSeconds).toBe(1500);
    expect(sessions[0].tagId).toBe("tag-study");
  });

  it("filters out sample-* and seed-* sessions in migrations.importBackup so dev sample data never leaks to cloud", async () => {
    const t = convexTest(schema, modules);
    const { asUser } = await createAuthenticatedTestUser(t);

    const result = await asUser.mutation(api.migrations.importBackup, {
      mode: "merge",
      tags: [{ id: "custom-1", name: "Coding", color: "#10B981", isArchived: false, createdAt: "2026-03-01T00:00:00.000Z" }],
      sessions: [
        {
          id: "sample-0-1-999999",
          tagId: "tag-study",
          sessionType: "WORK",
          durationSeconds: 1500,
          completedAt: "2026-03-11T10:00:00.000Z",
        },
        {
          id: "seed-12345",
          tagId: "tag-work",
          sessionType: "WORK",
          durationSeconds: 1500,
          completedAt: "2026-03-11T12:00:00.000Z",
        },
        {
          id: "session-real-1",
          tagId: "custom-1",
          sessionType: "WORK",
          durationSeconds: 1800,
          completedAt: "2026-03-12T15:00:00.000Z",
        },
      ],
      coffeeCups: [
        {
          id: "sample-coffee-1",
          tagId: "tag-study",
          date: "2026-03-11",
          createdAt: "2026-03-11T08:00:00.000Z",
        },
        {
          id: "coffee-real-1",
          tagId: "custom-1",
          date: "2026-03-12",
          createdAt: "2026-03-12T09:00:00.000Z",
        },
      ],
    });

    expect(result.success).toBe(true);

    const cloudSessions = await asUser.query(api.sessions.list, {});
    expect(cloudSessions).toHaveLength(1);
    expect(cloudSessions[0].completedAt).toBe("2026-03-12T15:00:00.000Z");

    const cloudCoffee = await asUser.query(api.coffee.list, {});
    expect(cloudCoffee).toHaveLength(1);
    expect(cloudCoffee[0].date).toBe("2026-03-12");
  });
});

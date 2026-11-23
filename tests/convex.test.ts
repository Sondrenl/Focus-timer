// @vitest-environment edge-runtime
import { describe, it, expect, vi } from "vitest";
vi.hoisted(() => {
  if (typeof (globalThis as any).window === "undefined") (globalThis as any).window = {};
  if (!(globalThis as any).window.location) (globalThis as any).window.location = { hostname: "localhost" };
});
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { useCloudMigration } from "../src/hooks/data/useCloudMigration";

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
    expect(activeTimer?.activeTagId).toBeNull();
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

  it("updates tagId when timer.pause is called with a new tag selection while PAUSED", async () => {
    const t = convexTest(schema, modules);
    const { asUser } = await createAuthenticatedTestUser(t);

    await asUser.mutation(api.timer.start, {
      sessionType: "WORK",
      durationSeconds: 1500,
      remainingSeconds: 1500,
      totalSeconds: 1500,
      currentCycle: 1,
      tagId: "tag-study",
      timerRunId: "run-pause-tag",
    });

    await asUser.mutation(api.timer.pause, {
      remainingSeconds: 1200,
      tagId: "tag-study",
    });

    // Change tag while paused
    await asUser.mutation(api.timer.pause, {
      remainingSeconds: 1200,
      tagId: "tag-deep-work",
    });

    const activeTimer = await asUser.query(api.timer.getActive, {});
    expect(activeTimer?.status).toBe("PAUSED");
    expect(activeTimer?.remainingSeconds).toBe(1200);
    expect(activeTimer?.activeTagId).toBe("tag-deep-work");
  });

  it("remaps duplicate-named tags and sanitizes orphaned tagIds during migrations.importBackup merge", async () => {
    const t = convexTest(schema, modules);
    const { asUser } = await createAuthenticatedTestUser(t);

    await asUser.mutation(api.migrations.importBackup, {
      mode: "merge",
      tags: [{ id: "external-study-id", name: "Study & Learning", color: "#3B82F6" }],
      sessions: [
        {
          id: "s-remapped",
          tagId: "external-study-id",
          sessionType: "WORK",
          durationSeconds: 1500,
          completedAt: "2026-03-15T10:00:00.000Z",
        },
        {
          id: "s-orphaned",
          tagId: "non-existent-tag",
          sessionType: "WORK",
          durationSeconds: 1500,
          completedAt: "2026-03-15T11:00:00.000Z",
        },
      ],
      coffeeCups: [
        {
          id: "c-remapped",
          date: "2026-03-15",
          tagId: "external-study-id",
          createdAt: "2026-03-15T10:30:00.000Z",
        },
      ],
    });

    const sessions = await asUser.query(api.sessions.list, {});
    const remappedSession = sessions?.find((s) => s.completedAt === "2026-03-15T10:00:00.000Z");
    const orphanedSession = sessions?.find((s) => s.completedAt === "2026-03-15T11:00:00.000Z");
    expect(remappedSession?.tagId).toBe("tag-study");
    expect(orphanedSession?.tagId).toBeNull();

    const coffee = await asUser.query(api.coffee.list, {});
    expect(coffee?.[0]?.tagId).toBe("tag-study");
  });

  it("refuses stale timer.reset when onlyIfNotRunning, expectedTimerRunId, or expectedUpdatedAtMs guards fail", async () => {
    const t = convexTest(schema, modules);
    const { asUser } = await createAuthenticatedTestUser(t);

    // Phone starts focus session
    const started = await asUser.mutation(api.timer.start, {
      sessionType: "WORK",
      durationSeconds: 1500,
      remainingSeconds: 1500,
      totalSeconds: 1500,
      currentCycle: 2,
      tagId: "tag-study",
      timerRunId: "phone-focus-run-2",
    });

    // Stale laptop mount / new-day reset with onlyIfNotRunning must NOT overwrite the phone's RUNNING focus timer
    await asUser.mutation(api.timer.reset, {
      sessionType: "WORK",
      durationSeconds: 1500,
      currentCycle: 1,
      onlyIfNotRunning: true,
    });

    let active = await asUser.query(api.timer.getActive, {});
    expect(active?.status).toBe("RUNNING");
    expect(active?.currentCycle).toBe(2);
    expect(active?.timerRunId).toBe("phone-focus-run-2");

    // Stale >15m overdue self-heal for an older run ID must NOT overwrite the newer phone run
    await asUser.mutation(api.timer.reset, {
      sessionType: "SHORT_BREAK",
      durationSeconds: 300,
      currentCycle: 1,
      expectedTimerRunId: "old-laptop-break-run-1",
    });

    active = await asUser.query(api.timer.getActive, {});
    expect(active?.status).toBe("RUNNING");
    expect(active?.timerRunId).toBe("phone-focus-run-2");

    // Stale reset with older expectedUpdatedAtMs must NOT overwrite newer state
    await asUser.mutation(api.timer.reset, {
      sessionType: "WORK",
      durationSeconds: 1500,
      currentCycle: 1,
      expectedUpdatedAtMs: started.updatedAtMs - 10_000,
    });

    active = await asUser.query(api.timer.getActive, {});
    expect(active?.status).toBe("RUNNING");
    expect(active?.timerRunId).toBe("phone-focus-run-2");

    // Explicit user reset without guards still resets normally
    await asUser.mutation(api.timer.reset, {
      sessionType: "WORK",
      durationSeconds: 1500,
      currentCycle: 1,
    });

    active = await asUser.query(api.timer.getActive, {});
    expect(active?.status).toBe("IDLE");
    expect(active?.currentCycle).toBe(1);
    expect(active?.timerRunId).toBeNull();
  });

  it("rejects run-less complete calls against tagged runs and allows Case 2 autoStartNext within 120s", async () => {
    const t = convexTest(schema, modules);
    const { userId, asUser } = await createAuthenticatedTestUser(t);

    // Phone starts a tagged WORK run
    await asUser.mutation(api.timer.start, {
      sessionType: "WORK",
      durationSeconds: 1500,
      remainingSeconds: 1500,
      totalSeconds: 1500,
      currentCycle: 2,
      tagId: "tag-study",
      timerRunId: "run-work-2",
    });

    // Stale device without matching timerRunId cannot complete the active run
    await asUser.mutation(api.timer.complete, {
      nextSessionType: "SHORT_BREAK",
      nextDurationSeconds: 300,
      nextCurrentCycle: 2,
      autoStartNext: false,
    });

    let active = await asUser.query(api.timer.getActive, {});
    expect(active?.status).toBe("RUNNING");
    expect(active?.timerRunId).toBe("run-work-2");

    // Simulate an IDLE state WITHOUT lastCompletedTimerRunId (e.g., user manually skipped/reset)
    const fortyFiveSecondsAgo = Date.now() - 45_000;
    await t.run(async (ctx) => {
      const existing = await ctx.db
        .query("active_timers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          sessionType: "WORK",
          status: "IDLE",
          remainingSeconds: 1500,
          totalSeconds: 1500,
          targetEndTime: undefined,
          currentCycle: 2,
          timerRunId: undefined,
          lastCompletedTimerRunId: undefined,
          updatedAtMs: fortyFiveSecondsAgo,
        });
      }
    });

    // Ghost auto-start without matching lastCompletedTimerRunId MUST be rejected
    await asUser.mutation(api.timer.complete, {
      completedTimerRunId: "break-run-1",
      nextSessionType: "WORK",
      nextDurationSeconds: 1500,
      nextCurrentCycle: 2,
      autoStartNext: true,
      nextTimerRunId: "ghost-auto-work-run",
    });

    active = await asUser.query(api.timer.getActive, {});
    expect(active?.status).toBe("IDLE");

    // Now simulate server onTimerCompleted finishing SHORT_BREAK 45s ago (records lastCompletedTimerRunId)
    await t.run(async (ctx) => {
      const existing = await ctx.db
        .query("active_timers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          lastCompletedTimerRunId: "break-run-1",
        });
      }
    });

    // Mismatched nextSessionType/cycle should NOT auto-start Case 2
    await asUser.mutation(api.timer.complete, {
      completedTimerRunId: "break-run-1",
      nextSessionType: "SHORT_BREAK",
      nextDurationSeconds: 300,
      nextCurrentCycle: 2,
      autoStartNext: true,
      nextTimerRunId: "wrong-next-run",
    });

    active = await asUser.query(api.timer.getActive, {});
    expect(active?.status).toBe("IDLE");

    // Case 2b refuses stale client autoStartNext when server settings have autoStartPomodoros OFF
    await asUser.mutation(api.timer.complete, {
      completedTimerRunId: "break-run-1",
      nextSessionType: "WORK",
      nextDurationSeconds: 1500,
      nextCurrentCycle: 2,
      autoStartNext: true,
      nextTimerRunId: "blocked-work-run-2",
    });

    active = await asUser.query(api.timer.getActive, {});
    expect(active?.status).toBe("IDLE");

    // Once server settings enable autoStartPomodoros, matching Case 2b transitions WORK cycle 2 to RUNNING
    await asUser.mutation(api.users.updateSettings, {
      autoStartPomodoros: true,
    });

    await asUser.mutation(api.timer.complete, {
      completedTimerRunId: "break-run-1",
      nextSessionType: "WORK",
      nextDurationSeconds: 1500,
      nextCurrentCycle: 2,
      autoStartNext: true,
      nextTimerRunId: "auto-work-run-2",
    });

    active = await asUser.query(api.timer.getActive, {});
    expect(active?.status).toBe("RUNNING");
    expect(active?.sessionType).toBe("WORK");
    expect(active?.currentCycle).toBe(2);
    expect(active?.timerRunId).toBe("auto-work-run-2");
  });

  it("increments cycle on SHORT_BREAK server completion after client timer.complete", async () => {
    const t = convexTest(schema, modules);
    const { userId, asUser } = await createAuthenticatedTestUser(t);

    await asUser.mutation(api.timer.start, {
      sessionType: "WORK",
      durationSeconds: 1500,
      remainingSeconds: 1,
      totalSeconds: 1500,
      currentCycle: 1,
      tagId: "tag-study",
      timerRunId: "run-attempt-reconcile",
    });

    await asUser.mutation(api.timer.complete, {
      completedTimerRunId: "run-attempt-reconcile",
      nextSessionType: "SHORT_BREAK",
      nextDurationSeconds: 300,
      nextCurrentCycle: 1,
      autoStartNext: true,
      nextTimerRunId: "run-short-break-1",
    });

    await t.mutation(internal.timer.onTimerCompleted, {
      userId,
      timerRunId: "run-short-break-1",
    });

    const activeAfterBreak = await asUser.query(api.timer.getActive, {});
    expect(activeAfterBreak?.sessionType).toBe("WORK");
    expect(activeAfterBreak?.currentCycle).toBe(2);
    expect(activeAfterBreak?.status).toBe("IDLE");
  });

  it("regenerates invalid tag IDs during importBackup", async () => {
    const t = convexTest(schema, modules);
    const { asUser } = await createAuthenticatedTestUser(t);

    // Import backup with invalid tag ID containing spaces/special characters
    await asUser.mutation(api.migrations.importBackup, {
      mode: "merge",
      tags: [{ id: "invalid tag id!@#", name: "Deep Research", color: "#8B5CF6" }],
      sessions: [
        {
          id: "s-invalid-tag",
          tagId: "invalid tag id!@#",
          sessionType: "WORK",
          durationSeconds: 1500,
          completedAt: "2026-03-18T10:00:00.000Z",
        },
      ],
      coffeeCups: [],
    });

    const userState = await asUser.query(api.users.current, {});
    const importedTag = userState?.tags.find((tag) => tag.name === "Deep Research");
    expect(importedTag).toBeDefined();
    expect(importedTag?.id).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);

    // Verify the remapped tag ID can be updated without failing TAG_ID_REGEX
    await asUser.mutation(api.tags.update, {
      id: importedTag!.id,
      name: "Deep Research Updated",
      color: "#8B5CF6",
    });
    const updatedUserState = await asUser.query(api.users.current, {});
    expect(updatedUserState?.tags.find((tag) => tag.id === importedTag!.id)?.name).toBe(
      "Deep Research Updated"
    );
  });

  it("blocks phantom user auto-creation for deleted accounts and upgrades legacy bare sub tokenIdentifier", async () => {
    const t = convexTest(schema, modules);
    const { userId, asUser } = await createAuthenticatedTestUser(t);

    await t.run(async (ctx) => ctx.db.delete(userId));
    expect(await asUser.query(api.users.current, {})).toBeNull();
    await expect(
      asUser.mutation(api.sessions.record, {
        sessionType: "WORK",
        durationSeconds: 1500,
        completedAt: "2026-04-01T10:00:00.000Z",
      })
    ).rejects.toThrow("Unauthorized");

    const legacyId = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        tokenIdentifier: "legacy-sub-999",
        email: "legacy@example.com",
        displayName: "Legacy User",
        avatarEmoji: "🦉",
        dailyGoalMinutes: 120,
        settings: {
          workDurationMinutes: 25,
          shortBreakDurationMinutes: 5,
          longBreakDurationMinutes: 25,
          longBreakInterval: 4,
          autoStartBreaks: false,
          autoStartPomodoros: false,
          soundVolume: 0.7,
          soundEnabled: true,
          notificationsEnabled: false,
          keepAwake: false,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        tags: [],
      })
    );
    expect(
      await t.mutation(internal.users.getOrCreateUserForAuth, {
        email: "legacy@example.com",
        sub: "legacy-sub-999",
        name: "Legacy User",
      })
    ).toBe(legacyId);
    const upgraded = await t.run(async (ctx) => ctx.db.get(legacyId));
    expect(upgraded?.tokenIdentifier).toBe("https://accounts.google.com|legacy-sub-999");
  });

  it("omits serverNowMs from getActive, resets streak via acknowledgeActive, rejects stale actions, and coerces invalid tagIds", async () => {
    const t = convexTest(schema, modules);
    const { userId, asUser } = await createAuthenticatedTestUser(t);

    const first = await asUser.mutation(api.timer.start, {
      sessionType: "WORK",
      durationSeconds: 1500,
      currentCycle: 1,
      tagId: "tag-does-not-exist",
      timerRunId: "run-ack-1",
    });
    expect(first.applied).toBe(true);
    expect(first.tagId).toBeUndefined();

    await t.run(async (ctx) => {
      const active = await ctx.db
        .query("active_timers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first();
      if (active) await ctx.db.patch(active._id, { serverAutoStartStreak: 2 });
    });

    const activeBefore = await asUser.query(api.timer.getActive, {});
    expect("serverNowMs" in (activeBefore as Record<string, unknown>)).toBe(false);
    expect((await asUser.mutation(api.timer.acknowledgeActive, { timerRunId: "run-ack-1" })).acknowledged).toBe(true);
    expect((await asUser.query(api.timer.getActive, {}))?.serverAutoStartStreak).toBe(0);

    const staleStart = await asUser.mutation(api.timer.start, {
      sessionType: "SHORT_BREAK",
      durationSeconds: 300,
      currentCycle: 1,
      timerRunId: "run-stale-2",
      clientActionAtMs: first.updatedAtMs - 10_000,
    });
    expect(staleStart.applied).toBe(false);

    const elapsedStart = await asUser.mutation(api.timer.start, {
      sessionType: "WORK",
      durationSeconds: 60,
      currentCycle: 1,
      timerRunId: "run-stale-3",
      clientTargetEndTimeMs: Date.now() - 5_000,
    });
    expect(elapsedStart.rejectedReason).toBe("already_elapsed");

    const staleReset = await asUser.mutation(api.timer.reset, {
      sessionType: "WORK",
      durationSeconds: 1500,
      currentCycle: 1,
      clientActionAtMs: first.updatedAtMs - 10_000,
    });
    expect(staleReset.applied).toBe(false);

    const session = await asUser.mutation(api.sessions.record, {
      tagId: "tag-does-not-exist",
      sessionType: "WORK",
      durationSeconds: 1500,
      completedAt: "2026-04-02T10:00:00.000Z",
    });
    expect(session.tagId).toBeNull();
  });

  it("prevents duplicate coffee deletion from deleting another cup and propagates tag removal to active_timers", async () => {
    const t = convexTest(schema, modules);
    const { asUser } = await createAuthenticatedTestUser(t);

    const cup1 = await asUser.mutation(api.coffee.addCup, { date: "2026-04-05", tagId: "tag-study", createdAt: "2026-04-05T08:00:00.000Z" });
    const cup2 = await asUser.mutation(api.coffee.addCup, { date: "2026-04-05", tagId: "tag-study", createdAt: "2026-04-05T09:00:00.000Z" });

    expect(await asUser.mutation(api.coffee.removeCup, { id: cup1.id, date: "2026-04-05", tagId: "tag-study" })).toBe(true);
    expect(await asUser.mutation(api.coffee.removeCup, { id: cup1.id, date: "2026-04-05", tagId: "tag-study" })).toBe(false);
    expect((await asUser.query(api.coffee.list, { date: "2026-04-05" }))?.map((c) => c.id)).toEqual([cup2.id]);

    await asUser.mutation(api.tags.create, { id: "tag-custom-timer", name: "Custom Timer", color: "#EF4444" });
    const started = await asUser.mutation(api.timer.start, {
      sessionType: "WORK",
      durationSeconds: 1500,
      currentCycle: 1,
      tagId: "tag-custom-timer",
      timerRunId: "run-tag-remove-1",
    });
    await asUser.mutation(api.tags.remove, { id: "tag-custom-timer" });
    const activeAfter = await asUser.query(api.timer.getActive, {});
    expect(activeAfter?.tagId).toBeUndefined();
    expect(activeAfter!.updatedAtMs).toBeGreaterThanOrEqual(started.updatedAtMs);
  });

  it("handles importBackup tag collisions, replace dangling timer tagId cleanup, and chunked clearForReplaceBatch", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.migrations.clearForReplaceBatch, {})).rejects.toThrow(/Unauthorized/i);

    const { userId, asUser } = await createAuthenticatedTestUser(t);

    // Colliding tag ID with different name mints a fresh tag ID and remaps sessions
    await asUser.mutation(api.migrations.importBackup, {
      mode: "merge",
      tags: [{ id: "tag-study", name: "Quantum Physics", color: "#8B5CF6", isArchived: false }],
      sessions: [{ id: "g-1", tagId: "tag-study", sessionType: "WORK", durationSeconds: 1500, completedAt: "2026-04-06T12:00:00.000Z", timerRunId: "run-u-1" }],
      coffeeCups: [],
    });
    const userAfterMerge = await asUser.query(api.users.current, {});
    const quantumTag = userAfterMerge?.tags.find((tag) => tag.name === "Quantum Physics");
    expect(quantumTag?.id).not.toBe("tag-study");
    const mergedSessions = await asUser.query(api.sessions.list, {});
    expect(mergedSessions?.[0].tagId).toBe(quantumTag?.id);
    expect(mergedSessions?.[0].timerRunId).toBe("run-u-1");

    // Chunked replace wipes >500 docs via clearForReplaceBatch and clears dangling active_timers.tagId
    await asUser.mutation(api.timer.start, { sessionType: "WORK", durationSeconds: 1500, currentCycle: 1, tagId: "tag-study", timerRunId: "run-rep-1" });
    await t.run(async (ctx) => {
      const baseMs = Date.parse("2026-01-01T00:00:00.000Z");
      for (let i = 0; i < 520; i++) {
        await ctx.db.insert("sessions", { userId, tagId: "tag-study", sessionType: "WORK", durationSeconds: 1500, completedAt: new Date(baseMs + i * 60_000).toISOString() });
      }
    });

    const clearBatchSpy = vi.fn(async () => asUser.mutation(api.migrations.clearForReplaceBatch, {}));
    const importBackupSpy = vi.fn(async (args: any) => asUser.mutation(api.migrations.importBackup, args));
    let syncChunked!: ReturnType<typeof useCloudMigration>["syncBackupToConvexChunked"];
    function Harness() {
      syncChunked = useCloudMigration({
        isEffectiveAuthenticated: true,
        convexSync: {
          isConvexConfigured: true,
          convexUser: undefined,
          convexCoffee: undefined,
          convexSessions: undefined,
          mutations: { clearForReplaceBatch: clearBatchSpy, importBackup: importBackupSpy } as any,
        } as any,
      }).syncBackupToConvexChunked;
      return null;
    }
    renderToStaticMarkup(React.createElement(Harness));

    await syncChunked(
      "replace",
      [{ id: "tag-fresh", name: "Fresh Focus", color: "#10B981", isArchived: false }],
      [{ id: "new-s-1", tagId: "tag-fresh", sessionType: "WORK", durationSeconds: 1800, completedAt: "2026-04-01T10:00:00.000Z" }],
      []
    );
    expect(clearBatchSpy).toHaveBeenCalledTimes(2);
    expect(importBackupSpy.mock.calls[0][0].skipReplaceClear).toBe(true);
    expect(await asUser.query(api.sessions.list, { limit: 5000 })).toHaveLength(1);
    expect((await asUser.query(api.timer.getActive, {}))?.tagId).toBeUndefined();
  });
});

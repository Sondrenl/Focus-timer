// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.*s");

describe("Section 3: Auth, Cloud Sync & Multi-Device Backend Hardening", () => {
  async function createAuthenticatedTestUser(
    t: ReturnType<typeof convexTest>,
    overrides?: { email?: string; sub?: string; name?: string }
  ) {
    const email = overrides?.email ?? "user@example.com";
    const sub = overrides?.sub ?? "google-sub-123";
    const name = overrides?.name ?? "Test Practitioner";
    const userId = await t.mutation(internal.users.getOrCreateUserForAuth, {
      email,
      sub,
      name,
    });
    const asUser = t.withIdentity({
      subject: `${userId}|session-1`,
      email,
      name,
    });
    return { userId, asUser };
  }

  describe("Auth identity hardening & canonical tokenIdentifier", () => {
    it("does NOT auto-create a phantom user when a Convex Auth user was deleted", async () => {
      const t = convexTest(schema, modules);
      const { userId, asUser } = await createAuthenticatedTestUser(t);

      // Delete the user document directly (simulating deleted account while session JWT still exists)
      await t.run(async (ctx) => {
        await ctx.db.delete(userId);
      });

      // Query must return null
      const current = await asUser.query(api.users.current, {});
      expect(current).toBeNull();

      // Mutation with autoCreate: true must throw Unauthorized rather than creating a phantom user
      await expect(
        asUser.mutation(api.sessions.record, {
          sessionType: "WORK",
          durationSeconds: 1500,
          completedAt: "2026-04-01T10:00:00.000Z",
        })
      ).rejects.toThrow("Unauthorized");

      const totalUsers = await t.run(async (ctx) => (await ctx.db.query("users").collect()).length);
      expect(totalUsers).toBe(0);
    });

    it("standardizes tokenIdentifier to canonical Google format and migrates legacy bare sub", async () => {
      const t = convexTest(schema, modules);

      // Seed a legacy user document with bare sub as tokenIdentifier
      const legacyId = await t.run(async (ctx) => {
        return await ctx.db.insert("users", {
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
        });
      });

      // Re-authenticating with the same sub finds and upgrades the existing user
      const resolvedId = await t.mutation(internal.users.getOrCreateUserForAuth, {
        email: "legacy@example.com",
        sub: "legacy-sub-999",
        name: "Legacy User",
      });
      expect(resolvedId).toBe(legacyId);

      const upgraded = await t.run(async (ctx) => ctx.db.get(legacyId));
      expect(upgraded?.tokenIdentifier).toBe("https://accounts.google.com|legacy-sub-999");

      // Brand-new users immediately get canonical tokenIdentifier
      const freshId = await t.mutation(internal.users.getOrCreateUserForAuth, {
        email: "fresh@example.com",
        sub: "fresh-sub-456",
        name: "Fresh User",
      });
      const freshUser = await t.run(async (ctx) => ctx.db.get(freshId));
      expect(freshUser?.tokenIdentifier).toBe("https://accounts.google.com|fresh-sub-456");
    });
  });

  describe("Timer query determinism, stale action guards & acknowledgeActive", () => {
    it("omits serverNowMs from api.timer.getActive and resets serverAutoStartStreak via acknowledgeActive", async () => {
      const t = convexTest(schema, modules);
      const { userId, asUser } = await createAuthenticatedTestUser(t);

      await asUser.mutation(api.timer.start, {
        sessionType: "WORK",
        durationSeconds: 1500,
        currentCycle: 1,
        timerRunId: "run-ack-1",
      });

      // Simulate server-side auto-start streak > 0
      await t.run(async (ctx) => {
        const active = await ctx.db
          .query("active_timers")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .first();
        if (active) {
          await ctx.db.patch(active._id, { serverAutoStartStreak: 2 });
        }
      });

      const activeBefore = await asUser.query(api.timer.getActive, {});
      expect(activeBefore).not.toBeNull();
      expect("serverNowMs" in (activeBefore as Record<string, unknown>)).toBe(false);
      expect(activeBefore?.serverAutoStartStreak).toBe(2);

      const ack = await asUser.mutation(api.timer.acknowledgeActive, {
        timerRunId: "run-ack-1",
      });
      expect(ack.acknowledged).toBe(true);
      expect(typeof ack.serverNowMs).toBe("number");

      const activeAfter = await asUser.query(api.timer.getActive, {});
      expect(activeAfter?.serverAutoStartStreak).toBe(0);
    });

    it("rejects stale clientActionAtMs and already_elapsed clientTargetEndTimeMs on timer.start / timer.reset", async () => {
      const t = convexTest(schema, modules);
      const { asUser } = await createAuthenticatedTestUser(t);

      const first = await asUser.mutation(api.timer.start, {
        sessionType: "WORK",
        durationSeconds: 1500,
        currentCycle: 1,
        timerRunId: "run-stale-1",
      });
      expect(first.applied).toBe(true);

      // Stale offline start from 10 seconds before the current active timer's updatedAtMs
      const staleStart = await asUser.mutation(api.timer.start, {
        sessionType: "SHORT_BREAK",
        durationSeconds: 300,
        currentCycle: 1,
        timerRunId: "run-stale-2",
        clientActionAtMs: first.updatedAtMs - 10_000,
      });
      expect(staleStart.applied).toBe(false);
      expect(staleStart.timerRunId).toBe("run-stale-1");

      // Already-elapsed offline start
      const elapsedStart = await asUser.mutation(api.timer.start, {
        sessionType: "WORK",
        durationSeconds: 60,
        currentCycle: 1,
        timerRunId: "run-stale-3",
        clientTargetEndTimeMs: Date.now() - 5_000,
      });
      expect(elapsedStart.applied).toBe(false);
      expect(elapsedStart.rejectedReason).toBe("already_elapsed");

      // Stale offline reset
      const staleReset = await asUser.mutation(api.timer.reset, {
        sessionType: "WORK",
        durationSeconds: 1500,
        currentCycle: 1,
        clientActionAtMs: first.updatedAtMs - 10_000,
      });
      expect(staleReset.applied).toBe(false);
      expect(staleReset.timerRunId).toBe("run-stale-1");
    });

    it("coerces deleted or nonexistent tagId to undefined on timer, session, and coffee writes", async () => {
      const t = convexTest(schema, modules);
      const { asUser } = await createAuthenticatedTestUser(t);

      const started = await asUser.mutation(api.timer.start, {
        sessionType: "WORK",
        durationSeconds: 1500,
        currentCycle: 1,
        tagId: "tag-does-not-exist",
        timerRunId: "run-tag-coerce-1",
      });
      expect(started.tagId).toBeUndefined();

      const session = await asUser.mutation(api.sessions.record, {
        tagId: "tag-does-not-exist",
        sessionType: "WORK",
        durationSeconds: 1500,
        completedAt: "2026-04-02T10:00:00.000Z",
      });
      expect(session.tagId).toBeNull();

      const cup = await asUser.mutation(api.coffee.addCup, {
        date: "2026-04-02",
        tagId: "tag-does-not-exist",
      });
      expect(cup.tagId).toBeNull();
    });
  });

  describe("Coffee deletion safety (H10) & tag removal propagation", () => {
    it("returns false when removeCup targets an already-deleted valid Convex ID instead of deleting another cup", async () => {
      const t = convexTest(schema, modules);
      const { asUser } = await createAuthenticatedTestUser(t);

      const cup1 = await asUser.mutation(api.coffee.addCup, {
        date: "2026-04-05",
        tagId: "tag-study",
        createdAt: "2026-04-05T08:00:00.000Z",
      });
      const cup2 = await asUser.mutation(api.coffee.addCup, {
        date: "2026-04-05",
        tagId: "tag-study",
        createdAt: "2026-04-05T09:00:00.000Z",
      });

      // Device A deletes cup1
      const firstDelete = await asUser.mutation(api.coffee.removeCup, {
        id: cup1.id,
        date: "2026-04-05",
        tagId: "tag-study",
      });
      expect(firstDelete).toBe(true);

      // Device B retries deleting the SAME cup1 ID — must return false and preserve cup2!
      const duplicateDelete = await asUser.mutation(api.coffee.removeCup, {
        id: cup1.id,
        date: "2026-04-05",
        tagId: "tag-study",
      });
      expect(duplicateDelete).toBe(false);

      const remaining = await asUser.query(api.coffee.list, { date: "2026-04-05" });
      expect(remaining).toHaveLength(1);
      expect(remaining?.[0].id).toBe(cup2.id);
    });

    it("bumps active_timers.updatedAtMs when tags.remove clears the active timer tagId", async () => {
      const t = convexTest(schema, modules);
      const { asUser } = await createAuthenticatedTestUser(t);

      await asUser.mutation(api.tags.create, {
        id: "tag-custom-timer",
        name: "Custom Timer",
        color: "#EF4444",
      });

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
  });

  describe("Backup migration hardening (H4, M9, M10, H12)", () => {
    it("mints a fresh tag ID on merge when incoming tag collides on ID with a different name and preserves timerRunId", async () => {
      const t = convexTest(schema, modules);
      const { asUser } = await createAuthenticatedTestUser(t);

      // User's cloud account has default tag-study ("Study & Learning").
      // Guest renamed their local tag-study to "Quantum Physics".
      await asUser.mutation(api.migrations.importBackup, {
        mode: "merge",
        tags: [
          {
            id: "tag-study",
            name: "Quantum Physics",
            color: "#8B5CF6",
            isArchived: false,
            createdAt: "2026-01-10T00:00:00.000Z",
            updatedAt: "2026-02-10T00:00:00.000Z",
          },
        ],
        sessions: [
          {
            id: "guest-sess-1",
            tagId: "tag-study",
            sessionType: "WORK",
            durationSeconds: 1500,
            completedAt: "2026-04-06T12:00:00.000Z",
            timerRunId: "run-unique-1",
          },
        ],
        coffeeCups: [],
      });

      const user = await asUser.query(api.users.current, {});
      const tagIds = (user?.tags ?? []).map((tag) => tag.id);
      // No duplicate tag IDs
      expect(new Set(tagIds).size).toBe(tagIds.length);

      const originalStudy = user?.tags.find((tag) => tag.id === "tag-study");
      const quantumTag = user?.tags.find((tag) => tag.name === "Quantum Physics");
      expect(originalStudy?.name).toBe("Study & Learning");
      expect(quantumTag).toBeDefined();
      expect(quantumTag?.id).not.toBe("tag-study");
      expect(quantumTag?.createdAt).toBe("2026-01-10T00:00:00.000Z");

      // Session should be remapped to the newly minted Quantum Physics tag ID and retain timerRunId
      const sessions = await asUser.query(api.sessions.list, {});
      expect(sessions).toHaveLength(1);
      expect(sessions?.[0].tagId).toBe(quantumTag?.id);
      expect(sessions?.[0].timerRunId).toBe("run-unique-1");
    });

    it("upgrades an existing in_progress telemetry attempt when merge imports a finalized version", async () => {
      const t = convexTest(schema, modules);
      const { asUser } = await createAuthenticatedTestUser(t);

      const baseAttempt = {
        attemptId: "attempt-upgrade-1",
        sessionType: "WORK" as const,
        status: "in_progress" as const,
        wasStarted: true,
        plannedDurationSeconds: 1500,
        actualActiveSeconds: 600,
        remainingSecondsAtEnd: 900,
        completionRatio: 0.4,
        startedAt: "2026-04-06T10:00:00.000Z",
        endedAt: null,
        utcOffsetMinutes: 0,
        ianaTimezone: "UTC",
        localDate: "2026-04-06",
        localHour: 10,
        localMinuteOfDay: 600,
        localDayOfWeek: 1,
        cycleIndex: 1,
        longBreakInterval: 4,
        autoStarted: false,
        initialTagId: "tag-study",
        tagId: "tag-study",
        tagChangedMidRun: false,
        pauseCount: 0,
        totalPausedSeconds: 0,
        pauseIntervals: [],
        timeSincePreviousAttemptSeconds: null,
        previousAttemptType: null,
        previousAttemptOutcome: null,
        workSessionsCompletedToday: 0,
        workActiveSecondsToday: 0,
        skipsToday: 0,
        coffeeCupsTodayAtStart: 0,
        minutesSinceLastCoffeeAtStart: null,
        coffeeLoggedDuringRun: 0,
        dailyGoalMinutes: 120,
        settingsSnapshot: {
          workDurationMinutes: 25,
          shortBreakDurationMinutes: 5,
          longBreakDurationMinutes: 25,
          longBreakInterval: 4,
          autoStartBreaks: false,
          autoStartPomodoros: false,
        },
        deviceClass: "desktop" as const,
        tabBackgroundedCount: 0,
        source: "client" as const,
        updatedAtMs: Date.parse("2026-04-06T10:10:00.000Z"),
      };

      await asUser.mutation(api.telemetry.upsertAttempt, baseAttempt);

      // Merge import delivers the finalized attempt
      await asUser.mutation(api.migrations.importBackup, {
        mode: "merge",
        tags: [],
        sessions: [],
        coffeeCups: [],
        mlTelemetry: {
          schemaVersion: 1,
          sessionAttempts: [
            {
              ...baseAttempt,
              status: "completed",
              actualActiveSeconds: 1500,
              remainingSecondsAtEnd: 0,
              completionRatio: 1,
              endedAt: "2026-04-06T10:25:00.000Z",
              updatedAtMs: Date.parse("2026-04-06T10:25:00.000Z"),
            },
          ],
          events: [],
        },
      });

      const attempts = await asUser.query(api.telemetry.listAttempts, {});
      expect(attempts).toHaveLength(1);
      expect(attempts?.[0].status).toBe("completed");
      expect(attempts?.[0].actualActiveSeconds).toBe(1500);
    });

    it("clears dangling active_timers.tagId on replace import", async () => {
      const t = convexTest(schema, modules);
      const { asUser } = await createAuthenticatedTestUser(t);

      await asUser.mutation(api.timer.start, {
        sessionType: "WORK",
        durationSeconds: 1500,
        currentCycle: 1,
        tagId: "tag-study",
        timerRunId: "run-replace-1",
      });

      await asUser.mutation(api.migrations.importBackup, {
        mode: "replace",
        tags: [
          {
            id: "tag-only-new",
            name: "Only New",
            color: "#10B981",
            isArchived: false,
          },
        ],
        sessions: [],
        coffeeCups: [],
      });

      const active = await asUser.query(api.timer.getActive, {});
      expect(active?.tagId).toBeUndefined();
    });
  });
});

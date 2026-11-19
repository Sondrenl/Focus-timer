// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.*s");

function makeSampleAttempt(overrides: Record<string, unknown> = {}) {
  return {
    attemptId: "attempt-1",
    sessionType: "WORK" as const,
    status: "in_progress" as const,
    wasStarted: true,
    plannedDurationSeconds: 1500,
    actualActiveSeconds: 300,
    remainingSecondsAtEnd: 1200,
    completionRatio: 0.2,
    startedAt: "2026-11-18T10:00:00.000Z",
    endedAt: null,
    utcOffsetMinutes: 60,
    ianaTimezone: "Europe/Oslo",
    localDate: "2026-11-18",
    localHour: 11,
    localMinuteOfDay: 660,
    localDayOfWeek: 3,
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
    coffeeCupsTodayAtStart: 1,
    minutesSinceLastCoffeeAtStart: 30,
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
    completionLatencySeconds: null,
    source: "client" as const,
    updatedAtMs: 1700000000000,
    ...overrides,
  };
}

function makeSampleEvent(overrides: Record<string, unknown> = {}) {
  return {
    eventId: "evt-1",
    eventType: "session_started" as const,
    timestamp: "2026-11-18T10:00:00.000Z",
    timestampMs: 1700000000000,
    utcOffsetMinutes: 60,
    ianaTimezone: "Europe/Oslo",
    localDate: "2026-11-18",
    localHour: 11,
    localMinuteOfDay: 660,
    localDayOfWeek: 3,
    deviceClass: "desktop" as const,
    attemptId: "attempt-1",
    sessionType: "WORK" as const,
    tagId: "tag-study",
    plannedDurationSeconds: 1500,
    source: "client" as const,
    ...overrides,
  };
}

describe("Passive ML Telemetry Convex Backend", () => {
  async function createAuthenticatedTestUser(t: ReturnType<typeof convexTest>) {
    const userId = await t.mutation(internal.users.getOrCreateUserForAuth, {
      email: "telemetry-user@example.com",
      sub: "google-telemetry-sub",
      name: "Telemetry Tester",
    });
    const asUser = t.withIdentity({
      subject: `${userId}|session-telemetry`,
      email: "telemetry-user@example.com",
      name: "Telemetry Tester",
    });
    return { userId, asUser };
  }

  it("returns null for unauthenticated queries and isolates telemetry strictly per authenticated user", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.telemetry.listAttempts, {})).toBeNull();
    expect(await t.query(api.telemetry.listEvents, {})).toBeNull();
    await expect(
      t.mutation(api.telemetry.upsertAttempt, makeSampleAttempt())
    ).rejects.toThrow();

    const { asUser: asUserA } = await createAuthenticatedTestUser(t);
    const userBId = await t.mutation(internal.users.getOrCreateUserForAuth, {
      email: "user-b@example.com",
      sub: "google-user-b-sub",
      name: "User B",
    });
    const asUserB = t.withIdentity({
      subject: `${userBId}|session-b`,
      email: "user-b@example.com",
      name: "User B",
    });

    await asUserA.mutation(
      api.telemetry.upsertAttempt,
      makeSampleAttempt({ attemptId: "shared-id-1" })
    );
    await asUserA.mutation(api.telemetry.recordEvents, {
      events: [makeSampleEvent({ eventId: "shared-evt-1" })],
    });

    // User B cannot see User A's attempts/events or clear them
    expect(await asUserB.query(api.telemetry.listAttempts, {})).toEqual([]);
    expect(await asUserB.query(api.telemetry.listEvents, {})).toEqual([]);
    await asUserB.mutation(api.telemetry.clear, {});
    expect(await asUserA.query(api.telemetry.listAttempts, {})).toHaveLength(1);
    expect(await asUserA.query(api.telemetry.listEvents, {})).toHaveLength(1);
  });

  it("upserts session_attempts, prevents finalized downgrade/older overwrites, and lists by date/index", async () => {
    const t = convexTest(schema, modules);
    const { asUser } = await createAuthenticatedTestUser(t);

    // Insert in_progress attempt
    const inserted = await asUser.mutation(
      api.telemetry.upsertAttempt,
      makeSampleAttempt()
    );
    expect(inserted.attemptId).toBe("attempt-1");
    expect(inserted.endedAt).toBeNull();

    // Finalize attempt
    const finalized = await asUser.mutation(
      api.telemetry.upsertAttempt,
      makeSampleAttempt({
        status: "completed",
        actualActiveSeconds: 1500,
        remainingSecondsAtEnd: 0,
        completionRatio: 1,
        endedAt: "2026-11-18T10:25:00.000Z",
        completionLatencySeconds: 1,
        updatedAtMs: 1700001500000,
      })
    );
    expect(finalized.status).toBe("completed");

    // Attempt to downgrade back to in_progress with newer timestamp -> must keep finalized
    const afterDowngradeAttempt = await asUser.mutation(
      api.telemetry.upsertAttempt,
      makeSampleAttempt({
        status: "in_progress",
        updatedAtMs: 1700002000000,
      })
    );
    expect(afterDowngradeAttempt.status).toBe("completed");

    // Attempt to overwrite finalized with older updatedAtMs -> must keep newer finalized
    const afterOlderAttempt = await asUser.mutation(
      api.telemetry.upsertAttempt,
      makeSampleAttempt({
        status: "skipped",
        endedAt: "2026-11-18T10:10:00.000Z",
        updatedAtMs: 1700001000000,
      })
    );
    expect(afterOlderAttempt.status).toBe("completed");

    // Insert second attempt on another date
    await asUser.mutation(
      api.telemetry.upsertAttempt,
      makeSampleAttempt({
        attemptId: "attempt-2",
        status: "skipped",
        localDate: "2026-11-19",
        endedAt: "2026-11-19T09:05:00.000Z",
        updatedAtMs: 1700080000000,
      })
    );

    const all = await asUser.query(api.telemetry.listAttempts, {});
    expect(all).toHaveLength(2);

    const filtered = await asUser.query(api.telemetry.listAttempts, {
      startDate: "2026-11-19",
      endDate: "2026-11-19",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered?.[0].attemptId).toBe("attempt-2");
  });

  it("validates bounds and deduplicates ml_events in recordEvents", async () => {
    const t = convexTest(schema, modules);
    const { asUser } = await createAuthenticatedTestUser(t);

    await expect(
      asUser.mutation(
        api.telemetry.upsertAttempt,
        makeSampleAttempt({ attemptId: "bad id!" })
      )
    ).rejects.toThrow("Invalid attemptId format.");

    await expect(
      asUser.mutation(
        api.telemetry.upsertAttempt,
        makeSampleAttempt({ localHour: 24 })
      )
    ).rejects.toThrow("localHour must be between 0 and 23.");

    const res1 = await asUser.mutation(api.telemetry.recordEvents, {
      events: [
        makeSampleEvent({ eventId: "evt-1" }),
        makeSampleEvent({ eventId: "evt-1" }), // duplicate in same batch
        makeSampleEvent({
          eventId: "evt-2",
          eventType: "coffee_logged",
          localDate: "2026-11-19",
          timestampMs: 1700080000000,
          cupId: "cup-1",
          cupDate: "2026-11-19",
          cupIndexToday: 1,
        }),
      ],
    });
    expect(res1).toEqual({ insertedCount: 2, skippedCount: 1 });

    // Re-send evt-1 -> skipped
    const res2 = await asUser.mutation(api.telemetry.recordEvents, {
      events: [makeSampleEvent({ eventId: "evt-1" })],
    });
    expect(res2).toEqual({ insertedCount: 0, skippedCount: 1 });

    const eventsAll = await asUser.query(api.telemetry.listEvents, {});
    expect(eventsAll).toHaveLength(2);

    const eventsFiltered = await asUser.query(api.telemetry.listEvents, {
      startDate: "2026-11-19",
      endDate: "2026-11-19",
    });
    expect(eventsFiltered).toHaveLength(1);
    expect(eventsFiltered?.[0].eventId).toBe("evt-2");

    // Clear all telemetry
    const cleared = await asUser.mutation(api.telemetry.clear, {});
    expect(cleared).toBe(true);
    expect(await asUser.query(api.telemetry.listAttempts, {})).toEqual([]);
    expect(await asUser.query(api.telemetry.listEvents, {})).toEqual([]);
  });

  it("reconciles in_progress attempts without emitting duplicate ml_events in timer.onTimerCompleted", async () => {
    const t = convexTest(schema, modules);
    const { userId, asUser } = await createAuthenticatedTestUser(t);

    await asUser.mutation(
      api.telemetry.upsertAttempt,
      makeSampleAttempt({
        attemptId: "run-srv-1",
        status: "in_progress",
        utcOffsetMinutes: 120,
        ianaTimezone: "Europe/Berlin",
        deviceClass: "mobile",
      })
    );

    const nowMs = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("active_timers", {
        userId,
        sessionType: "WORK",
        status: "RUNNING",
        remainingSeconds: 1500,
        totalSeconds: 1500,
        targetEndTime: nowMs - 2000,
        currentCycle: 1,
        tagId: "tag-study",
        timerRunId: "run-srv-1",
        updatedAtMs: nowMs - 1500_000,
      });
    });

    await t.mutation(internal.timer.onTimerCompleted, {
      userId,
      timerRunId: "run-srv-1",
    });

    const attempts = await asUser.query(api.telemetry.listAttempts, {});
    expect(attempts).toHaveLength(1);
    expect(attempts?.[0].status).toBe("completed");
    expect(attempts?.[0].source).toBe("server_scheduled");
    expect(attempts?.[0].completionRatio).toBe(1);
    expect(attempts?.[0].remainingSecondsAtEnd).toBe(0);

    // Session lifecycle events are no longer duplicated in ml_events
    const events = await asUser.query(api.telemetry.listEvents, {});
    expect(events).toHaveLength(0);

    // Client upsertAttempt with future timestamp must NOT overwrite server_scheduled finalization
    const clientAttemptOverwrite = await asUser.mutation(
      api.telemetry.upsertAttempt,
      makeSampleAttempt({
        attemptId: "run-srv-1",
        status: "skipped",
        source: "client",
        updatedAtMs: Date.now() + 60_000,
      })
    );
    expect(clientAttemptOverwrite.status).toBe("completed");
    expect(clientAttemptOverwrite.source).toBe("server_scheduled");
  });

  it("marks stale in_progress attempts as abandoned_stale without emitting duplicate ml_event in cleanupStaleTimers", async () => {
    const t = convexTest(schema, modules);
    const { userId, asUser } = await createAuthenticatedTestUser(t);

    await asUser.mutation(
      api.telemetry.upsertAttempt,
      makeSampleAttempt({
        attemptId: "run-stale-1",
        status: "in_progress",
      })
    );

    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("active_timers", {
        userId,
        sessionType: "WORK",
        status: "RUNNING",
        remainingSeconds: 0,
        totalSeconds: 1500,
        targetEndTime: now - 2 * 3600 * 1000,
        currentCycle: 1,
        timerRunId: "run-stale-1",
        updatedAtMs: now - 2 * 3600 * 1000,
      });
    });

    await t.mutation(internal.timer.cleanupStaleTimers, {});

    const attempts = await asUser.query(api.telemetry.listAttempts, {});
    expect(attempts).toHaveLength(1);
    expect(attempts?.[0].status).toBe("abandoned_stale");
    expect(attempts?.[0].source).toBe("server_scheduled");
    expect(attempts?.[0].endedAt).not.toBeNull();

    const events = await asUser.query(api.telemetry.listEvents, {});
    expect(events).toHaveLength(0);
  });

  it("clears orphaned tagId and initialTagId references in session_attempts on tags.remove and tags.resetToDefaults", async () => {
    const t = convexTest(schema, modules);
    const { asUser } = await createAuthenticatedTestUser(t);

    const custom1 = await asUser.mutation(api.tags.create, {
      name: "Custom Alpha",
      color: "#10B981",
    });
    const custom2 = await asUser.mutation(api.tags.create, {
      name: "Custom Beta",
      color: "#F59E0B",
    });

    await asUser.mutation(
      api.telemetry.upsertAttempt,
      makeSampleAttempt({
        attemptId: "att-tag-1",
        initialTagId: custom1.id,
        tagId: custom2.id,
        tagChangedMidRun: true,
      })
    );

    await asUser.mutation(api.tags.remove, { id: custom1.id });
    let attempts = await asUser.query(api.telemetry.listAttempts, {});
    expect(attempts?.[0].initialTagId).toBeNull();
    expect(attempts?.[0].tagId).toBe(custom2.id);

    await asUser.mutation(api.tags.resetToDefaults, {});
    attempts = await asUser.query(api.telemetry.listAttempts, {});
    expect(attempts?.[0].initialTagId).toBeNull();
    expect(attempts?.[0].tagId).toBeNull();
  });

  it("imports and remaps mlTelemetry in migrations.importBackup (merge & replace) while staying backwards-compatible", async () => {
    const t = convexTest(schema, modules);
    const { asUser } = await createAuthenticatedTestUser(t);

    // Seed an existing attempt & event that replace mode should clear
    await asUser.mutation(
      api.telemetry.upsertAttempt,
      makeSampleAttempt({ attemptId: "old-attempt" })
    );
    await asUser.mutation(api.telemetry.recordEvents, {
      events: [makeSampleEvent({ eventId: "old-event" })],
    });

    // Replace mode with mlTelemetry
    await asUser.mutation(api.migrations.importBackup, {
      mode: "replace",
      tags: [{ id: "ext-tag", name: "Study & Learning", color: "#5C6BC0" }],
      sessions: [],
      mlTelemetry: {
        schemaVersion: 1,
        sessionAttempts: [
          makeSampleAttempt({
            attemptId: "imported-att-1",
            status: "completed",
            endedAt: "2026-11-18T10:25:00.000Z",
            initialTagId: "ext-tag",
            tagId: "missing-tag",
          }),
        ],
        events: [
          makeSampleEvent({
            eventId: "imported-evt-1",
            eventType: "tag_changed",
            fromTagId: "ext-tag",
            toTagId: "missing-tag",
            tagId: "ext-tag",
          }),
        ],
      },
    });

    let attempts = await asUser.query(api.telemetry.listAttempts, {});
    expect(attempts).toHaveLength(1);
    expect(attempts?.[0].attemptId).toBe("imported-att-1");
    expect(attempts?.[0].initialTagId).toBe("ext-tag");
    expect(attempts?.[0].tagId).toBeNull();

    let events = await asUser.query(api.telemetry.listEvents, {});
    expect(events).toHaveLength(1);
    expect(events?.[0].eventId).toBe("imported-evt-1");
    expect(events?.[0].fromTagId).toBe("ext-tag");
    expect(events?.[0].toTagId).toBeNull();

    // Merge mode deduplicates existing attemptId/eventId and remaps duplicate-named tag
    await asUser.mutation(api.migrations.importBackup, {
      mode: "merge",
      tags: [{ id: "dup-name-tag", name: "Study & Learning", color: "#5C6BC0" }],
      sessions: [],
      mlTelemetry: {
        schemaVersion: 1,
        sessionAttempts: [
          makeSampleAttempt({
            attemptId: "imported-att-1", // duplicate -> ignored
            status: "skipped",
          }),
          makeSampleAttempt({
            attemptId: "imported-att-2",
            status: "completed",
            endedAt: "2026-11-18T11:25:00.000Z",
            initialTagId: "dup-name-tag",
            tagId: "dup-name-tag",
          }),
        ],
        events: [
          makeSampleEvent({ eventId: "imported-evt-1" }), // duplicate -> ignored
          makeSampleEvent({
            eventId: "imported-evt-2",
            tagId: "dup-name-tag",
          }),
        ],
      },
    });

    attempts = await asUser.query(api.telemetry.listAttempts, {});
    expect(attempts).toHaveLength(2);
    const att2 = attempts?.find((a) => a.attemptId === "imported-att-2");
    expect(att2?.initialTagId).toBe("ext-tag");
    expect(att2?.tagId).toBe("ext-tag");

    events = await asUser.query(api.telemetry.listEvents, {});
    expect(events).toHaveLength(2);
    const evt2 = events?.find((e) => e.eventId === "imported-evt-2");
    expect(evt2?.tagId).toBe("ext-tag");
  });

  it("discards in_progress short attempts and their lifecycle events while protecting finalized attempts and coffee events", async () => {
    const t = convexTest(schema, modules);
    const { asUser } = await createAuthenticatedTestUser(t);

    const otherUserId = await t.mutation(internal.users.getOrCreateUserForAuth, {
      email: "other-discard@example.com",
      sub: "google-other-discard",
      name: "Other User",
    });
    const asOtherUser = t.withIdentity({
      subject: `${otherUserId}|session-other`,
      email: "other-discard@example.com",
      name: "Other User",
    });

    await asUser.mutation(
      api.telemetry.upsertAttempt,
      makeSampleAttempt({ attemptId: "short-run-1", status: "in_progress" })
    );
    await asUser.mutation(api.telemetry.recordEvents, {
      events: [
        makeSampleEvent({
          eventId: "evt-start-short-run-1",
          eventType: "session_started",
          attemptId: "short-run-1",
        }),
        makeSampleEvent({
          eventId: "evt-pause-short-run-1",
          eventType: "session_paused",
          attemptId: "short-run-1",
          timestampMs: 1700000005000,
        }),
        makeSampleEvent({
          eventId: "evt-coffee-during-short",
          eventType: "coffee_logged",
          attemptId: "short-run-1",
          cupId: "cup-short-1",
          cupDate: "2026-11-18",
          cupIndexToday: 1,
          timestampMs: 1700000006000,
        }),
      ],
    });

    // Another user cannot discard asUser's attempt
    await asOtherUser.mutation(api.telemetry.discardAttempt, { attemptId: "short-run-1" });
    expect(await asUser.query(api.telemetry.listAttempts, {})).toHaveLength(1);

    // Owner discards in_progress attempt
    const discarded = await asUser.mutation(api.telemetry.discardAttempt, {
      attemptId: "short-run-1",
    });
    expect(discarded).toBe(true);
    expect(await asUser.query(api.telemetry.listAttempts, {})).toEqual([]);

    const remainingEvents = await asUser.query(api.telemetry.listEvents, {});
    expect(remainingEvents).toHaveLength(1);
    expect(remainingEvents?.[0].eventId).toBe("evt-coffee-during-short");
    expect(remainingEvents?.[0].attemptId).toBeNull();

    // Finalized attempts cannot be discarded
    await asUser.mutation(
      api.telemetry.upsertAttempt,
      makeSampleAttempt({
        attemptId: "final-run-1",
        status: "completed",
        endedAt: "2026-11-18T10:25:00.000Z",
      })
    );
    const discardFinalized = await asUser.mutation(api.telemetry.discardAttempt, {
      attemptId: "final-run-1",
    });
    expect(discardFinalized).toBe(false);
    expect(await asUser.query(api.telemetry.listAttempts, {})).toHaveLength(1);
  });

  it("enforces status precedence and merges cross-device synthesized finalization with existing in_progress context", async () => {
    const t = convexTest(schema, modules);
    const { asUser } = await createAuthenticatedTestUser(t);

    // 1. Device A starts run with rich context & pauses
    await asUser.mutation(
      api.telemetry.upsertAttempt,
      makeSampleAttempt({
        attemptId: "cross-dev-1",
        status: "in_progress",
        startedAt: "2026-11-18T10:00:00.000Z",
        autoStarted: true,
        initialTagId: "tag-initial",
        tagId: "tag-initial",
        pauseCount: 2,
        totalPausedSeconds: 90,
        pauseIntervals: [
          {
            pausedAt: "2026-11-18T10:05:00.000Z",
            resumedAt: "2026-11-18T10:06:00.000Z",
            durationSeconds: 60,
            elapsedActiveSecondsAtPause: 300,
            remainingSecondsAtPause: 1200,
          },
          {
            pausedAt: "2026-11-18T10:12:00.000Z",
            resumedAt: "2026-11-18T10:12:30.000Z",
            durationSeconds: 30,
            elapsedActiveSecondsAtPause: 660,
            remainingSecondsAtPause: 840,
          },
        ],
        coffeeLoggedDuringRun: 1,
        tabBackgroundedCount: 3,
        updatedAtMs: 1700000800000,
      })
    );

    // 2. Device B submits synthesized completion (pauseCount: 0, shifted startedAt, updated tagId)
    const merged = await asUser.mutation(
      api.telemetry.upsertAttempt,
      makeSampleAttempt({
        attemptId: "cross-dev-1",
        status: "completed",
        actualActiveSeconds: 1500,
        remainingSecondsAtEnd: 0,
        completionRatio: 1,
        startedAt: "2026-11-18T10:01:30.000Z",
        endedAt: "2026-11-18T10:26:30.000Z",
        autoStarted: false,
        initialTagId: "tag-final",
        tagId: "tag-final",
        pauseCount: 0,
        totalPausedSeconds: 0,
        pauseIntervals: [],
        coffeeLoggedDuringRun: 0,
        tabBackgroundedCount: 0,
        updatedAtMs: 1700001600000,
      })
    );

    expect(merged.status).toBe("completed");
    expect(merged.startedAt).toBe("2026-11-18T10:00:00.000Z");
    expect(merged.autoStarted).toBe(true);
    expect(merged.initialTagId).toBe("tag-initial");
    expect(merged.tagId).toBe("tag-final");
    expect(merged.tagChangedMidRun).toBe(true);
    expect(merged.pauseCount).toBe(2);
    expect(merged.totalPausedSeconds).toBe(90);
    expect(merged.pauseIntervals).toHaveLength(2);
    expect(merged.coffeeLoggedDuringRun).toBe(1);
    expect(merged.tabBackgroundedCount).toBe(3);

    // 3. Even newer abandoned_stale must NOT overwrite completed
    const afterStale = await asUser.mutation(
      api.telemetry.upsertAttempt,
      makeSampleAttempt({
        attemptId: "cross-dev-1",
        status: "abandoned_stale",
        endedAt: "2026-11-18T12:00:00.000Z",
        updatedAtMs: 1700099999000,
      })
    );
    expect(afterStale.status).toBe("completed");

    // 4. Explicit skipped upgrades an existing client abandoned_stale attempt
    await asUser.mutation(
      api.telemetry.upsertAttempt,
      makeSampleAttempt({
        attemptId: "stale-then-skip",
        status: "abandoned_stale",
        endedAt: "2026-11-18T11:10:00.000Z",
        updatedAtMs: 1700010000000,
      })
    );
    const upgraded = await asUser.mutation(
      api.telemetry.upsertAttempt,
      makeSampleAttempt({
        attemptId: "stale-then-skip",
        status: "skipped",
        actualActiveSeconds: 400,
        remainingSecondsAtEnd: 1100,
        completionRatio: 0.2667,
        endedAt: "2026-11-18T11:06:40.000Z",
        updatedAtMs: 1700005000000, // older wall time still upgrades stale placeholder
      })
    );
    expect(upgraded.status).toBe("skipped");
    expect(upgraded.actualActiveSeconds).toBe(400);
  });

  it("sets accurate endedAt, actualActiveSeconds, remainingSecondsAtEnd, and completionRatio in cleanupStaleTimers", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();

    const userRunId = await t.mutation(internal.users.getOrCreateUserForAuth, {
      email: "stale-run@example.com",
      sub: "google-stale-run",
      name: "Stale Run",
    });
    const asRunUser = t.withIdentity({
      subject: `${userRunId}|sess-run`,
      email: "stale-run@example.com",
      name: "Stale Run",
    });

    const userPausedId = await t.mutation(internal.users.getOrCreateUserForAuth, {
      email: "stale-paused@example.com",
      sub: "google-stale-paused",
      name: "Stale Paused",
    });
    const asPausedUser = t.withIdentity({
      subject: `${userPausedId}|sess-paused`,
      email: "stale-paused@example.com",
      name: "Stale Paused",
    });

    await asRunUser.mutation(
      api.telemetry.upsertAttempt,
      makeSampleAttempt({
        attemptId: "run-expired-2h",
        status: "in_progress",
        plannedDurationSeconds: 1500,
        actualActiveSeconds: 0,
      })
    );
    await asPausedUser.mutation(
      api.telemetry.upsertAttempt,
      makeSampleAttempt({
        attemptId: "run-paused-8d",
        status: "in_progress",
        plannedDurationSeconds: 1500,
        actualActiveSeconds: 450,
      })
    );

    const expectedTargetEnd = now - 2 * 3600 * 1000;
    const eightDaysAgo = now - 8 * 24 * 3600 * 1000;
    await t.run(async (ctx) => {
      await ctx.db.insert("active_timers", {
        userId: userRunId,
        sessionType: "WORK",
        status: "RUNNING",
        remainingSeconds: 0,
        totalSeconds: 1500,
        targetEndTime: expectedTargetEnd,
        currentCycle: 1,
        timerRunId: "run-expired-2h",
        updatedAtMs: expectedTargetEnd,
      });
      await ctx.db.insert("active_timers", {
        userId: userPausedId,
        sessionType: "WORK",
        status: "PAUSED",
        remainingSeconds: 1050,
        totalSeconds: 1500,
        currentCycle: 1,
        timerRunId: "run-paused-8d",
        updatedAtMs: eightDaysAgo,
      });
    });

    await t.mutation(internal.timer.cleanupStaleTimers, {});

    const runAttempts = await asRunUser.query(api.telemetry.listAttempts, {});
    expect(runAttempts?.[0].status).toBe("abandoned_stale");
    expect(runAttempts?.[0].endedAt).toBe(new Date(expectedTargetEnd).toISOString());
    expect(runAttempts?.[0].actualActiveSeconds).toBe(1500);
    expect(runAttempts?.[0].remainingSecondsAtEnd).toBe(0);
    expect(runAttempts?.[0].completionRatio).toBe(1);

    const pausedAttempts = await asPausedUser.query(api.telemetry.listAttempts, {});
    expect(pausedAttempts?.[0].status).toBe("abandoned_stale");
    expect(pausedAttempts?.[0].actualActiveSeconds).toBe(450);
    expect(pausedAttempts?.[0].remainingSecondsAtEnd).toBe(1050);
    expect(pausedAttempts?.[0].completionRatio).toBe(0.3);
  });
});

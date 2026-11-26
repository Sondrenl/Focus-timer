// @vitest-environment edge-runtime
import { describe, it, expect } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { createConvexTest, createAuthenticatedTestUser } from "./helpers/authTestHelper";

function makeSampleAttempt(overrides: Record<string, unknown> = {}) {
  return {
    attemptId: "attempt-1",
    sessionType: "WORK" as const,
    status: "completed" as const,
    wasStarted: true,
    plannedDurationSeconds: 1500,
    actualActiveSeconds: 1500,
    remainingSecondsAtEnd: 0,
    completionRatio: 1,
    startedAt: "2026-11-18T10:00:00.000Z",
    endedAt: "2026-11-18T10:25:00.000Z",
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
    completionLatencySeconds: 1,
    source: "client" as const,
    updatedAtMs: 1700001500000,
    ...overrides,
  };
}

describe("ML Telemetry Convex Backend", () => {
  it("isolates telemetry per authenticated user and rejects unauthenticated writes", async () => {
    const t = createConvexTest();
    expect(await t.query(api.telemetry.listAttempts, {})).toBeNull();
    await expect(t.mutation(api.telemetry.upsertAttempt, makeSampleAttempt())).rejects.toThrow();

    const { asUser: asUserA } = await createAuthenticatedTestUser(t, {
      email: "telemetry-user@example.com",
      sub: "google-telemetry-sub",
      name: "Telemetry Tester",
    });
    const { asUser: asUserB } = await createAuthenticatedTestUser(t, {
      email: "user-b@example.com",
      sub: "google-user-b-sub",
      name: "User B",
    });

    await asUserA.mutation(
      api.telemetry.upsertAttempt,
      makeSampleAttempt({ attemptId: "shared-id-1" })
    );

    expect(await asUserB.query(api.telemetry.listAttempts, {})).toEqual([]);
    await asUserB.mutation(api.telemetry.clear, {});
    expect(await asUserA.query(api.telemetry.listAttempts, {})).toHaveLength(1);
  });

  it("validates bounds, protects completed attempts, upgrades stale attempts, filters by date, and clears", async () => {
    const t = createConvexTest();
    const { asUser } = await createAuthenticatedTestUser(t);

    await expect(
      asUser.mutation(api.telemetry.upsertAttempt, makeSampleAttempt({ attemptId: "bad id!" }))
    ).rejects.toThrow("Invalid attemptId format.");

    await expect(
      asUser.mutation(api.telemetry.upsertAttempt, makeSampleAttempt({ localHour: 24 }))
    ).rejects.toThrow("localHour must be between 0 and 23.");

    const finalized = await asUser.mutation(api.telemetry.upsertAttempt, makeSampleAttempt());
    expect(finalized.status).toBe("completed");

    // Completed attempt cannot be downgraded by stale or older skipped
    const afterStale = await asUser.mutation(
      api.telemetry.upsertAttempt,
      makeSampleAttempt({ status: "abandoned_stale", updatedAtMs: 1700009999000 })
    );
    expect(afterStale.status).toBe("completed");

    // Stale attempt can be upgraded to explicit skipped
    await asUser.mutation(
      api.telemetry.upsertAttempt,
      makeSampleAttempt({
        attemptId: "attempt-2",
        status: "abandoned_stale",
        localDate: "2026-11-19",
        updatedAtMs: 1700090000000,
      })
    );
    const upgraded = await asUser.mutation(
      api.telemetry.upsertAttempt,
      makeSampleAttempt({
        attemptId: "attempt-2",
        status: "skipped",
        localDate: "2026-11-19",
        actualActiveSeconds: 400,
        remainingSecondsAtEnd: 1100,
        completionRatio: 0.2667,
        updatedAtMs: 1700080000000,
      })
    );
    expect(upgraded.status).toBe("skipped");

    expect(await asUser.query(api.telemetry.listAttempts, {})).toHaveLength(2);
    const filtered = await asUser.query(api.telemetry.listAttempts, {
      startDate: "2026-11-19",
      endDate: "2026-11-19",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered?.[0].attemptId).toBe("attempt-2");

    expect(await asUser.mutation(api.telemetry.clear, {})).toBe(true);
    expect(await asUser.query(api.telemetry.listAttempts, {})).toEqual([]);
  });

  it("records server_scheduled fallback on timer completion, upgrades on richer client upsert, and blocks sparser overwrites or source spoofing", async () => {
    const t = createConvexTest();
    const { userId, asUser } = await createAuthenticatedTestUser(t);

    // 1. Start a timer and complete it server-side with no client telemetry row yet
    const startRes = await asUser.mutation(api.timer.start, {
      sessionType: "WORK",
      durationSeconds: 1500,
      currentCycle: 1,
      timerRunId: "run-bg-1",
    });
    expect(startRes.applied).toBe(true);

    await t.mutation(internal.timer.onTimerCompleted, {
      userId,
      timerRunId: "run-bg-1",
      scheduleNonce: startRes.scheduleNonce,
    });

    const afterServer = await asUser.query(api.telemetry.listAttempts, {});
    expect(afterServer).toHaveLength(1);
    expect(afterServer?.[0].attemptId).toBe("run-bg-1");
    expect(afterServer?.[0].status).toBe("completed");
    expect(afterServer?.[0].source).toBe("server_scheduled");

    // 2. Client upsert upgrades server_scheduled row with richer local telemetry
    const upgraded = await asUser.mutation(
      api.telemetry.upsertAttempt,
      makeSampleAttempt({
        attemptId: "run-bg-1",
        status: "completed",
        pauseCount: 2,
        tabBackgroundedCount: 1,
        source: "server_scheduled", // Public mutation must force "client"
        updatedAtMs: 1700002000000,
      })
    );
    expect(upgraded.source).toBe("client");
    expect(upgraded.pauseCount).toBe(2);
    expect(upgraded.tabBackgroundedCount).toBe(1);

    // 3. Sparser multi-tab upsert with newer updatedAtMs must not clobber the richer completed row
    const afterSparser = await asUser.mutation(
      api.telemetry.upsertAttempt,
      makeSampleAttempt({
        attemptId: "run-bg-1",
        status: "completed",
        pauseCount: 0,
        tabBackgroundedCount: 0,
        updatedAtMs: 1700009000000,
      })
    );
    expect(afterSparser.pauseCount).toBe(2);
    expect(afterSparser.tabBackgroundedCount).toBe(1);
  });
});

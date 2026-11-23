// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.*s");

describe("Topic 2 — Convex Timer Accuracy & Server-vs-Client Races", () => {
  async function createAuthenticatedTestUser(t: ReturnType<typeof convexTest>) {
    const userId = await t.mutation(internal.users.getOrCreateUserForAuth, {
      email: "accuracy@example.com",
      sub: "google-sub-accuracy",
      name: "Accuracy Tester",
    });
    const asUser = t.withIdentity({
      subject: `${userId}|session-1`,
      email: "accuracy@example.com",
      name: "Accuracy Tester",
    });
    return { userId, asUser };
  }

  it("honors autoStartBreaks on server completion with a safety cap of 1 unattended auto-start (Decision 1A)", async () => {
    const t = convexTest(schema, modules);
    const { userId, asUser } = await createAuthenticatedTestUser(t);

    // Enable both autoStartBreaks and autoStartPomodoros
    await asUser.mutation(api.users.updateSettings, {
      autoStartBreaks: true,
      autoStartPomodoros: true,
      workDurationMinutes: 25,
      shortBreakDurationMinutes: 5,
    });

    // User starts WORK cycle 1
    await asUser.mutation(api.timer.start, {
      sessionType: "WORK",
      durationSeconds: 1500,
      currentCycle: 1,
      tagId: "tag-study",
      timerRunId: "work-run-1",
    });

    const beforeComplete = await t.run(async (ctx) =>
      ctx.db
        .query("active_timers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first()
    );
    expect(beforeComplete?.scheduleNonce).toBeTruthy();

    // 1st unattended server completion (WORK -> SHORT_BREAK): auto-starts!
    await t.mutation(internal.timer.onTimerCompleted, {
      userId,
      timerRunId: "work-run-1",
      scheduleNonce: beforeComplete!.scheduleNonce,
    });

    const afterFirstServerComplete = await t.run(async (ctx) =>
      ctx.db
        .query("active_timers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first()
    );
    expect(afterFirstServerComplete?.status).toBe("RUNNING");
    expect(afterFirstServerComplete?.sessionType).toBe("SHORT_BREAK");
    expect(afterFirstServerComplete?.currentCycle).toBe(1);
    expect(afterFirstServerComplete?.serverAutoStartStreak).toBe(1);
    expect(afterFirstServerComplete?.lastCompletedTimerRunId).toBe("work-run-1");
    expect(afterFirstServerComplete?.timerRunId).toMatch(/^run-srv-/);

    // 2nd unattended server completion (SHORT_BREAK -> WORK cycle 2): hits safety cap (1), MUST land in IDLE!
    await t.mutation(internal.timer.onTimerCompleted, {
      userId,
      timerRunId: afterFirstServerComplete!.timerRunId!,
      scheduleNonce: afterFirstServerComplete!.scheduleNonce,
    });

    const afterSecondServerComplete = await t.run(async (ctx) =>
      ctx.db
        .query("active_timers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first()
    );
    expect(afterSecondServerComplete?.status).toBe("IDLE");
    expect(afterSecondServerComplete?.sessionType).toBe("WORK");
    expect(afterSecondServerComplete?.currentCycle).toBe(2);
    expect(afterSecondServerComplete?.lastCompletedTimerRunId).toBe(
      afterFirstServerComplete!.timerRunId
    );
  });

  it("adopts server auto-started run on client complete (Case 2a) and resets serverAutoStartStreak", async () => {
    const t = convexTest(schema, modules);
    const { userId, asUser } = await createAuthenticatedTestUser(t);

    await asUser.mutation(api.users.updateSettings, {
      autoStartBreaks: true,
      shortBreakDurationMinutes: 5,
    });

    await asUser.mutation(api.timer.start, {
      sessionType: "WORK",
      durationSeconds: 1500,
      currentCycle: 1,
      timerRunId: "work-run-case2a",
    });

    const runningRow = await t.run(async (ctx) =>
      ctx.db
        .query("active_timers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first()
    );

    // Server completes first and auto-starts SHORT_BREAK
    await t.mutation(internal.timer.onTimerCompleted, {
      userId,
      timerRunId: "work-run-case2a",
      scheduleNonce: runningRow!.scheduleNonce,
    });

    const serverStarted = await asUser.query(api.timer.getActive, {});
    expect(serverStarted?.status).toBe("RUNNING");
    expect(serverStarted?.sessionType).toBe("SHORT_BREAK");
    const serverRunId = serverStarted!.timerRunId;

    // Client arrives late with complete(completedTimerRunId: "work-run-case2a")
    const completeRes = await asUser.mutation(api.timer.complete, {
      completedTimerRunId: "work-run-case2a",
      nextSessionType: "SHORT_BREAK",
      nextDurationSeconds: 300,
      nextCurrentCycle: 1,
      autoStartNext: true,
      nextTimerRunId: "client-would-be-run",
    });

    // Must keep the server's authoritative run ID and reset streak to 0
    expect(completeRes?.status).toBe("RUNNING");
    expect(completeRes?.timerRunId).toBe(serverRunId);
    const dbRow = await t.run(async (ctx) =>
      ctx.db
        .query("active_timers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first()
    );
    expect(dbRow?.serverAutoStartStreak).toBe(0);
  });

  it("rejects stale scheduled onTimerCompleted jobs when scheduleNonce no longer matches after pause/resume", async () => {
    const t = convexTest(schema, modules);
    const { userId, asUser } = await createAuthenticatedTestUser(t);

    await asUser.mutation(api.timer.start, {
      sessionType: "WORK",
      durationSeconds: 1500,
      currentCycle: 1,
      timerRunId: "run-nonce-test",
    });

    const firstRow = await t.run(async (ctx) =>
      ctx.db
        .query("active_timers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first()
    );
    const staleNonce = firstRow!.scheduleNonce!;

    // Pause and resume with the same timerRunId -> generates a brand new scheduleNonce
    await asUser.mutation(api.timer.pause, {
      remainingSeconds: 1200,
      expectedTimerRunId: "run-nonce-test",
    });
    await asUser.mutation(api.timer.start, {
      sessionType: "WORK",
      durationSeconds: 1500,
      remainingSeconds: 1200,
      totalSeconds: 1500,
      currentCycle: 1,
      timerRunId: "run-nonce-test",
    });

    const resumedRow = await t.run(async (ctx) =>
      ctx.db
        .query("active_timers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first()
    );
    expect(resumedRow?.scheduleNonce).not.toBe(staleNonce);

    // Stale job fires with old nonce: MUST be ignored!
    await t.mutation(internal.timer.onTimerCompleted, {
      userId,
      timerRunId: "run-nonce-test",
      scheduleNonce: staleNonce,
    });

    const stillRunning = await asUser.query(api.timer.getActive, {});
    expect(stillRunning?.status).toBe("RUNNING");
    expect(stillRunning?.timerRunId).toBe("run-nonce-test");
  });

  it("enforces guards on timer.pause, timer.updateTag, timer.reset(onlyIfIdle), and timer.complete(too_early)", async () => {
    const t = convexTest(schema, modules);
    const { asUser } = await createAuthenticatedTestUser(t);

    // 1. Start a fresh 25m timer
    await asUser.mutation(api.timer.start, {
      sessionType: "WORK",
      durationSeconds: 1500,
      currentCycle: 1,
      tagId: "tag-study",
      timerRunId: "run-guard-1",
    });
    const started = await asUser.query(api.timer.getActive, {});
    const originalTargetEnd = started!.targetEndTime;

    // 2. updateTag patches ONLY tagId without changing targetEndTime or status
    const tagRes = await asUser.mutation(api.timer.updateTag, {
      tagId: "tag-deep-work",
      expectedStatus: "RUNNING",
      expectedTimerRunId: "run-guard-1",
    });
    expect(tagRes?.applied).toBe(true);
    expect(tagRes?.tagId).toBe("tag-deep-work");
    expect(tagRes?.targetEndTime).toBe(originalTargetEnd);

    // updateTag with wrong expectedTimerRunId is rejected
    const wrongTagRes = await asUser.mutation(api.timer.updateTag, {
      tagId: "tag-study",
      expectedStatus: "RUNNING",
      expectedTimerRunId: "wrong-run",
    });
    expect(wrongTagRes?.applied).toBe(false);
    expect(wrongTagRes?.tagId).toBe("tag-deep-work");

    // 3. complete >5s early returns rejectedReason: "too_early" and keeps RUNNING
    const earlyRes = await asUser.mutation(api.timer.complete, {
      completedTimerRunId: "run-guard-1",
      nextSessionType: "SHORT_BREAK",
      nextDurationSeconds: 300,
      nextCurrentCycle: 1,
      autoStartNext: false,
    });
    expect(earlyRes?.rejectedReason).toBe("too_early");
    expect(earlyRes?.status).toBe("RUNNING");

    // 4. pause with wrong expectedTimerRunId is refused
    const wrongPause = await asUser.mutation(api.timer.pause, {
      remainingSeconds: 1000,
      expectedTimerRunId: "other-run",
    });
    expect(wrongPause?.applied).toBe(false);
    expect(wrongPause?.status).toBe("RUNNING");

    // 5. pause clamps remainingSeconds <= totalSeconds (1500)
    const validPause = await asUser.mutation(api.timer.pause, {
      remainingSeconds: 9999,
      expectedTimerRunId: "run-guard-1",
    });
    expect(validPause?.applied).toBe(true);
    expect(validPause?.status).toBe("PAUSED");
    expect(validPause?.remainingSeconds).toBe(1500);

    // 6. reset with onlyIfIdle: true refuses to wipe a PAUSED timer
    const blockedReset = await asUser.mutation(api.timer.reset, {
      sessionType: "WORK",
      durationSeconds: 1800,
      currentCycle: 1,
      onlyIfIdle: true,
    });
    expect(blockedReset?.applied).toBe(false);
    expect(blockedReset?.status).toBe("PAUSED");

    // 7. Full reset transitions to IDLE; subsequent pause on IDLE is refused (no resurrection!)
    const fullReset = await asUser.mutation(api.timer.reset, {
      sessionType: "WORK",
      durationSeconds: 1500,
      currentCycle: 1,
    });
    expect(fullReset?.applied).toBe(true);
    expect(fullReset?.status).toBe("IDLE");

    const ghostPause = await asUser.mutation(api.timer.pause, {
      remainingSeconds: 600,
      expectedTimerRunId: "run-guard-1",
    });
    expect(ghostPause?.applied).toBe(false);
    expect(ghostPause?.status).toBe("IDLE");
  });

  it("deduplicates sessions by exact timerRunId across >45s skew while preserving rapid distinct short sessions", async () => {
    const t = convexTest(schema, modules);
    const { asUser } = await createAuthenticatedTestUser(t);

    // Same timerRunId recorded 120 seconds apart (clock skew > 45s) -> deduplicated!
    await asUser.mutation(api.sessions.record, {
      tagId: "tag-study",
      sessionType: "WORK",
      durationSeconds: 1500,
      completedAt: "2026-04-10T10:00:00.000Z",
      timerRunId: "same-run-skew",
    });
    await asUser.mutation(api.sessions.record, {
      tagId: "tag-study",
      sessionType: "WORK",
      durationSeconds: 1500,
      completedAt: "2026-04-10T10:02:00.000Z",
      timerRunId: "same-run-skew",
    });

    // Two distinct 5-second sessions 10 seconds apart with different timerRunIds -> BOTH kept!
    await asUser.mutation(api.sessions.record, {
      tagId: "tag-study",
      sessionType: "WORK",
      durationSeconds: 5,
      completedAt: "2026-04-10T11:00:00.000Z",
      timerRunId: "short-run-1",
    });
    await asUser.mutation(api.sessions.record, {
      tagId: "tag-study",
      sessionType: "WORK",
      durationSeconds: 5,
      completedAt: "2026-04-10T11:00:10.000Z",
      timerRunId: "short-run-2",
    });

    const listed = await asUser.query(api.sessions.list, {});
    expect(listed).toHaveLength(3);

    // Timezone-offset date bounds are normalized safely in sessions.list
    const filtered = await asUser.query(api.sessions.list, {
      startDate: "2026-04-10T12:30:00+02:00", // 10:30 UTC
      endDate: "2026-04-10T13:30:00+02:00",   // 11:30 UTC
    });
    expect(filtered).toHaveLength(2);
  });

  it("resets an abandoned RUNNING timer in cleanupStaleTimers and rejects non-integer durations", async () => {
    const t = convexTest(schema, modules);
    const { userId, asUser } = await createAuthenticatedTestUser(t);

    // Rejects fractional durationSeconds
    await expect(
      asUser.mutation(api.timer.start, {
        sessionType: "WORK",
        durationSeconds: 12.5,
        currentCycle: 1,
        timerRunId: "frac-run",
      })
    ).rejects.toThrow("durationSeconds must be an integer.");

    await asUser.mutation(api.timer.start, {
      sessionType: "WORK",
      durationSeconds: 1500,
      currentCycle: 1,
      timerRunId: "stale-running-1",
    });
    const oldMs = Date.now() - 25 * 60 * 60 * 1000;
    await t.run(async (ctx) => {
      const existing = await ctx.db
        .query("active_timers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          targetEndTime: oldMs,
          updatedAtMs: oldMs,
        });
      }
    });

    await t.mutation(internal.timer.cleanupStaleTimers, {});

    const cleaned = await t.run(async (ctx) =>
      ctx.db
        .query("active_timers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first()
    );
    expect(cleaned?.status).toBe("IDLE");
  });
});

import {
  AttemptOutcome,
  MlEvent,
  PauseInterval,
  SessionAttempt,
} from '../../types/telemetry';
import { SessionType } from '../../types/timer';
import { UserSettings } from '../../types/settings';
import { CoffeeCup } from '../../types/coffee';
import { ActiveAttemptDraft } from '../repository/TelemetryRepository';
import {
  buildLocalTimeContext,
  buildSettingsSnapshot,
  computeCoffeeContextAt,
  computePriorAttemptContext,
  getDeviceClass,
} from '../../utils/telemetryContext';

const MAX_PAUSE_INTERVALS = 50;

export function generateTelemetryId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function toNullableTelemetryId(id?: string | null): string | null {
  return id && id.trim().length > 0 ? id : null;
}

export function buildBaseTelemetryEvent(
  eventType: MlEvent['eventType'],
  dateOrMs: Date | number = new Date(),
  eventId?: string
): MlEvent {
  const t = buildLocalTimeContext(dateOrMs);
  return {
    eventId: eventId ?? generateTelemetryId('evt'),
    eventType,
    timestamp: t.timestamp,
    timestampMs: t.timestampMs,
    utcOffsetMinutes: t.utcOffsetMinutes,
    ianaTimezone: t.ianaTimezone,
    localDate: t.localDate,
    localHour: t.localHour,
    localMinuteOfDay: t.localMinuteOfDay,
    localDayOfWeek: t.localDayOfWeek,
    deviceClass: getDeviceClass(),
  };
}

export function createInitialAttemptDraft(params: {
  attemptId: string;
  sessionType: SessionType;
  plannedDurationSeconds: number;
  cycleIndex: number;
  tagId: string | null;
  autoStarted: boolean;
  settings: UserSettings;
  dailyGoalMinutes: number;
  coffeeCups: CoffeeCup[];
  priorAttempts: SessionAttempt[];
  targetEndTimeMs: number | null;
  nowMs: number;
}): ActiveAttemptDraft {
  const timeCtx = buildLocalTimeContext(params.nowMs);
  const coffeeMetrics = computeCoffeeContextAt(
    params.coffeeCups,
    timeCtx.localDate,
    params.nowMs
  );
  const priorMetrics = computePriorAttemptContext(
    params.priorAttempts,
    timeCtx.localDate,
    params.nowMs
  );

  const cleanTagId = toNullableTelemetryId(params.tagId);
  const settingsSnap = buildSettingsSnapshot(params.settings);
  const plannedSec = Math.max(1, Math.round(params.plannedDurationSeconds));

  const attempt: SessionAttempt = {
    attemptId: params.attemptId,
    sessionType: params.sessionType,
    status: 'in_progress',
    wasStarted: true,
    plannedDurationSeconds: plannedSec,
    actualActiveSeconds: 0,
    remainingSecondsAtEnd: plannedSec,
    completionRatio: 0,
    startedAt: timeCtx.timestamp,
    endedAt: null,
    utcOffsetMinutes: timeCtx.utcOffsetMinutes,
    ianaTimezone: timeCtx.ianaTimezone,
    localDate: timeCtx.localDate,
    localHour: timeCtx.localHour,
    localMinuteOfDay: timeCtx.localMinuteOfDay,
    localDayOfWeek: timeCtx.localDayOfWeek,
    cycleIndex: params.cycleIndex,
    longBreakInterval: params.settings.longBreakInterval,
    autoStarted: params.autoStarted,
    initialTagId: cleanTagId,
    tagId: cleanTagId,
    tagChangedMidRun: false,
    pauseCount: 0,
    totalPausedSeconds: 0,
    pauseIntervals: [],
    timeSincePreviousAttemptSeconds: priorMetrics.timeSincePreviousAttemptSeconds,
    previousAttemptType: priorMetrics.previousAttemptType,
    previousAttemptOutcome: priorMetrics.previousAttemptOutcome,
    workSessionsCompletedToday: priorMetrics.workSessionsCompletedToday,
    workActiveSecondsToday: priorMetrics.workActiveSecondsToday,
    skipsToday: priorMetrics.skipsToday,
    coffeeCupsTodayAtStart: coffeeMetrics.coffeeCupsToday,
    minutesSinceLastCoffeeAtStart: coffeeMetrics.minutesSinceLastCoffee,
    coffeeLoggedDuringRun: 0,
    dailyGoalMinutes: params.dailyGoalMinutes || 120,
    settingsSnapshot: settingsSnap,
    deviceClass: getDeviceClass(),
    tabBackgroundedCount: 0,
    completionLatencySeconds: null,
    source: 'client',
    updatedAtMs: params.nowMs,
  };

  return {
    attempt,
    activeSegmentStartMs: params.nowMs,
    accumulatedActiveMs: 0,
    currentPauseStartMs: null,
    targetEndTimeMs: params.targetEndTimeMs,
  };
}

export function resumeAttemptDraft(
  draft: ActiveAttemptDraft,
  nowMs: number,
  targetEndTimeMs: number | null
): ActiveAttemptDraft {
  const timeCtx = buildLocalTimeContext(nowMs);
  let pauseDurationSeconds = 0;
  const updatedPauses = [...draft.attempt.pauseIntervals];

  if (draft.currentPauseStartMs !== null) {
    pauseDurationSeconds = Math.max(
      0,
      Math.round((nowMs - draft.currentPauseStartMs) / 1000)
    );
    if (updatedPauses.length > 0) {
      const lastIdx = updatedPauses.length - 1;
      updatedPauses[lastIdx] = {
        ...updatedPauses[lastIdx],
        resumedAt: timeCtx.timestamp,
        durationSeconds: pauseDurationSeconds,
      };
    }
  }

  const updatedAttempt: SessionAttempt = {
    ...draft.attempt,
    totalPausedSeconds: draft.attempt.totalPausedSeconds + pauseDurationSeconds,
    pauseIntervals: updatedPauses,
    updatedAtMs: nowMs,
  };

  return {
    attempt: updatedAttempt,
    activeSegmentStartMs: nowMs,
    accumulatedActiveMs: draft.accumulatedActiveMs,
    currentPauseStartMs: null,
    targetEndTimeMs,
  };
}

export function pauseAttemptDraft(
  draft: ActiveAttemptDraft,
  params: {
    remainingSeconds: number;
    tagId?: string | null;
    nowMs: number;
  }
): ActiveAttemptDraft {
  const timeCtx = buildLocalTimeContext(params.nowMs);
  const segmentMs =
    draft.activeSegmentStartMs !== null
      ? Math.max(0, params.nowMs - draft.activeSegmentStartMs)
      : 0;
  const accumulatedActiveMs = draft.accumulatedActiveMs + segmentMs;
  const elapsedActiveSeconds = Math.max(0, Math.round(accumulatedActiveMs / 1000));

  const nextTagId =
    params.tagId !== undefined
      ? toNullableTelemetryId(params.tagId)
      : draft.attempt.tagId;
  const tagChangedMidRun =
    draft.attempt.tagChangedMidRun || nextTagId !== draft.attempt.initialTagId;

  const pauseEntry: PauseInterval = {
    pausedAt: timeCtx.timestamp,
    elapsedActiveSecondsAtPause: elapsedActiveSeconds,
    remainingSecondsAtPause: Math.max(0, Math.round(params.remainingSeconds)),
  };

  const nextPauses =
    draft.attempt.pauseIntervals.length < MAX_PAUSE_INTERVALS
      ? [...draft.attempt.pauseIntervals, pauseEntry]
      : draft.attempt.pauseIntervals;

  const updatedAttempt: SessionAttempt = {
    ...draft.attempt,
    tagId: nextTagId,
    tagChangedMidRun,
    actualActiveSeconds: elapsedActiveSeconds,
    pauseCount: draft.attempt.pauseCount + 1,
    pauseIntervals: nextPauses,
    updatedAtMs: params.nowMs,
  };

  return {
    attempt: updatedAttempt,
    activeSegmentStartMs: null,
    accumulatedActiveMs,
    currentPauseStartMs: params.nowMs,
    targetEndTimeMs: null,
  };
}

export function finalizeAttemptFromDraft(
  draft: ActiveAttemptDraft,
  params: {
    outcome: AttemptOutcome;
    plannedSec: number;
    remainingSec: number;
    cleanTagId: string | null;
    targetEndTimeMs?: number | null;
    nowMs: number;
  }
): SessionAttempt {
  const timeCtx = buildLocalTimeContext(params.nowMs);
  const effectiveTargetEnd = params.targetEndTimeMs ?? draft.targetEndTimeMs;
  const shouldCapAtTargetEnd =
    (params.outcome === 'completed' || params.outcome === 'abandoned_stale') &&
    effectiveTargetEnd !== null &&
    effectiveTargetEnd < params.nowMs;

  let accumulatedActiveMs = draft.accumulatedActiveMs;
  if (draft.activeSegmentStartMs !== null) {
    const effectiveEndMs = shouldCapAtTargetEnd ? effectiveTargetEnd! : params.nowMs;
    accumulatedActiveMs += Math.max(0, effectiveEndMs - draft.activeSegmentStartMs);
  }

  let totalPausedSeconds = draft.attempt.totalPausedSeconds;
  const updatedPauses = [...draft.attempt.pauseIntervals];
  if (draft.currentPauseStartMs !== null) {
    const extraPauseSec = Math.max(
      0,
      Math.round((params.nowMs - draft.currentPauseStartMs) / 1000)
    );
    totalPausedSeconds += extraPauseSec;
    if (updatedPauses.length > 0) {
      const lastIdx = updatedPauses.length - 1;
      updatedPauses[lastIdx] = {
        ...updatedPauses[lastIdx],
        resumedAt: timeCtx.timestamp,
        durationSeconds: extraPauseSec,
      };
    }
  }

  const wallActiveSec = Math.round(accumulatedActiveMs / 1000);
  const nominalElapsedSec = Math.max(0, params.plannedSec - params.remainingSec);
  const rawActiveSec = wallActiveSec > 0 ? wallActiveSec : nominalElapsedSec;
  const actualActiveSeconds =
    params.outcome === 'completed'
      ? Math.max(1, wallActiveSec > 0 ? Math.min(wallActiveSec, params.plannedSec) : params.plannedSec)
      : Math.max(0, Math.min(params.plannedSec, rawActiveSec));

  const completionLatencySeconds =
    params.outcome === 'completed' && effectiveTargetEnd !== null
      ? Math.max(0, Math.round((params.nowMs - effectiveTargetEnd) / 1000))
      : null;

  const endedMs = shouldCapAtTargetEnd ? effectiveTargetEnd! : params.nowMs;
  const remainingSecondsAtEnd =
    params.outcome === 'completed'
      ? 0
      : params.outcome === 'abandoned_stale'
      ? Math.max(0, params.plannedSec - actualActiveSeconds)
      : params.remainingSec;

  return {
    ...draft.attempt,
    status: params.outcome,
    endedAt: new Date(endedMs).toISOString(),
    tagId: params.cleanTagId,
    tagChangedMidRun:
      draft.attempt.tagChangedMidRun || params.cleanTagId !== draft.attempt.initialTagId,
    actualActiveSeconds,
    remainingSecondsAtEnd,
    completionRatio: Number(
      Math.min(1, actualActiveSeconds / params.plannedSec).toFixed(4)
    ),
    totalPausedSeconds,
    pauseIntervals: updatedPauses,
    completionLatencySeconds,
    source: 'client',
    updatedAtMs: params.nowMs,
  };
}

export function synthesizeRemoteAttempt(params: {
  resolvedAttemptId: string;
  outcome: AttemptOutcome;
  sessionType: SessionType;
  plannedSec: number;
  remainingSec: number;
  cycleIndex: number;
  cleanTagId: string | null;
  settings: UserSettings;
  dailyGoalMinutes: number;
  coffeeCups: CoffeeCup[];
  priorAttempts: SessionAttempt[];
  targetEndTimeMs?: number | null;
  nowMs: number;
}): SessionAttempt {
  const effectiveTargetEnd = params.targetEndTimeMs ?? null;
  const shouldCapAtTargetEnd =
    (params.outcome === 'completed' || params.outcome === 'abandoned_stale') &&
    effectiveTargetEnd !== null &&
    effectiveTargetEnd < params.nowMs;
  const endedMs = shouldCapAtTargetEnd ? effectiveTargetEnd! : params.nowMs;
  const endedCtx = buildLocalTimeContext(endedMs);

  const coffeeMetrics = computeCoffeeContextAt(
    params.coffeeCups,
    endedCtx.localDate,
    endedMs
  );
  const priorMetrics = computePriorAttemptContext(
    params.priorAttempts,
    endedCtx.localDate,
    endedMs
  );
  const actualActiveSeconds =
    params.outcome === 'completed'
      ? params.plannedSec
      : Math.max(0, Math.min(params.plannedSec, params.plannedSec - params.remainingSec));
  const remainingSecondsAtEnd =
    params.outcome === 'completed'
      ? 0
      : params.outcome === 'abandoned_stale'
      ? Math.max(0, params.plannedSec - actualActiveSeconds)
      : params.remainingSec;

  return {
    attemptId: params.resolvedAttemptId,
    sessionType: params.sessionType,
    status: params.outcome,
    wasStarted: true,
    plannedDurationSeconds: params.plannedSec,
    actualActiveSeconds,
    remainingSecondsAtEnd,
    completionRatio: Number(
      Math.min(1, actualActiveSeconds / params.plannedSec).toFixed(4)
    ),
    startedAt: new Date(endedMs - actualActiveSeconds * 1000).toISOString(),
    endedAt: endedCtx.timestamp,
    utcOffsetMinutes: endedCtx.utcOffsetMinutes,
    ianaTimezone: endedCtx.ianaTimezone,
    localDate: endedCtx.localDate,
    localHour: endedCtx.localHour,
    localMinuteOfDay: endedCtx.localMinuteOfDay,
    localDayOfWeek: endedCtx.localDayOfWeek,
    cycleIndex: params.cycleIndex,
    longBreakInterval: params.settings.longBreakInterval,
    autoStarted: false,
    initialTagId: params.cleanTagId,
    tagId: params.cleanTagId,
    tagChangedMidRun: false,
    pauseCount: 0,
    totalPausedSeconds: 0,
    pauseIntervals: [],
    timeSincePreviousAttemptSeconds: priorMetrics.timeSincePreviousAttemptSeconds,
    previousAttemptType: priorMetrics.previousAttemptType,
    previousAttemptOutcome: priorMetrics.previousAttemptOutcome,
    workSessionsCompletedToday: priorMetrics.workSessionsCompletedToday,
    workActiveSecondsToday: priorMetrics.workActiveSecondsToday,
    skipsToday: priorMetrics.skipsToday,
    coffeeCupsTodayAtStart: coffeeMetrics.coffeeCupsToday,
    minutesSinceLastCoffeeAtStart: coffeeMetrics.minutesSinceLastCoffee,
    coffeeLoggedDuringRun: 0,
    dailyGoalMinutes: params.dailyGoalMinutes || 120,
    settingsSnapshot: buildSettingsSnapshot(params.settings),
    deviceClass: getDeviceClass(),
    tabBackgroundedCount: 0,
    completionLatencySeconds:
      params.outcome === 'completed' && effectiveTargetEnd !== null
        ? Math.max(0, Math.round((params.nowMs - effectiveTargetEnd) / 1000))
        : null,
    source: 'client',
    updatedAtMs: params.nowMs,
  };
}

export function finalizeStaleAttemptDraft(
  draft: ActiveAttemptDraft,
  nowMs: number
): SessionAttempt {
  const timeCtx = buildLocalTimeContext(nowMs);
  let accumulatedActiveMs = draft.accumulatedActiveMs;
  if (draft.activeSegmentStartMs !== null) {
    const capMs =
      draft.targetEndTimeMs !== null && draft.targetEndTimeMs < nowMs
        ? draft.targetEndTimeMs
        : nowMs;
    accumulatedActiveMs += Math.max(0, capMs - draft.activeSegmentStartMs);
  }

  let totalPausedSeconds = draft.attempt.totalPausedSeconds;
  const updatedPauses = [...draft.attempt.pauseIntervals];
  if (draft.currentPauseStartMs !== null) {
    const extraPauseSec = Math.max(
      0,
      Math.round((nowMs - draft.currentPauseStartMs) / 1000)
    );
    totalPausedSeconds += extraPauseSec;
    if (updatedPauses.length > 0) {
      const lastIdx = updatedPauses.length - 1;
      updatedPauses[lastIdx] = {
        ...updatedPauses[lastIdx],
        resumedAt: timeCtx.timestamp,
        durationSeconds: extraPauseSec,
      };
    }
  }

  const plannedSec = Math.max(1, draft.attempt.plannedDurationSeconds);
  const wallActiveSec = Math.max(0, Math.min(plannedSec, Math.round(accumulatedActiveMs / 1000)));
  const remainingSecondsAtEnd = Math.max(0, plannedSec - wallActiveSec);
  const endedMs =
    draft.targetEndTimeMs !== null && draft.targetEndTimeMs < nowMs
      ? draft.targetEndTimeMs
      : nowMs;

  return {
    ...draft.attempt,
    status: 'abandoned_stale',
    endedAt: new Date(endedMs).toISOString(),
    actualActiveSeconds: wallActiveSec,
    remainingSecondsAtEnd,
    completionRatio: Number(Math.min(1, wallActiveSec / plannedSec).toFixed(4)),
    totalPausedSeconds,
    pauseIntervals: updatedPauses,
    source: 'client',
    updatedAtMs: nowMs,
  };
}

export function computeCoffeeLoggingMetrics(params: {
  cup: CoffeeCup;
  allCupsAfterAdd: CoffeeCup[];
  attempts: SessionAttempt[];
  nowMs: number;
}): {
  cupIndexToday: number;
  minutesSincePreviousCup: number | null;
  minutesSinceLastWorkEnd: number | null;
} {
  const cupsOnDate = params.allCupsAfterAdd.filter((c) => c.date === params.cup.date);
  const cupIndexToday = cupsOnDate.length;

  let prevCupMs: number | null = null;
  for (const c of params.allCupsAfterAdd) {
    if (c.id === params.cup.id) continue;
    const ms = Date.parse(c.createdAt);
    if (!Number.isNaN(ms) && ms <= params.nowMs) {
      if (prevCupMs === null || ms > prevCupMs) {
        prevCupMs = ms;
      }
    }
  }
  const minutesSincePreviousCup =
    prevCupMs !== null ? Math.max(0, Math.round((params.nowMs - prevCupMs) / 60000)) : null;

  let lastWorkEndMs: number | null = null;
  for (const att of params.attempts) {
    if (att.sessionType === 'WORK' && att.status !== 'in_progress' && att.endedAt) {
      const ms = Date.parse(att.endedAt);
      if (!Number.isNaN(ms) && ms <= params.nowMs) {
        if (lastWorkEndMs === null || ms > lastWorkEndMs) {
          lastWorkEndMs = ms;
        }
      }
    }
  }
  const minutesSinceLastWorkEnd =
    lastWorkEndMs !== null
      ? Math.max(0, Math.round((params.nowMs - lastWorkEndMs) / 60000))
      : null;

  return {
    cupIndexToday,
    minutesSincePreviousCup,
    minutesSinceLastWorkEnd,
  };
}

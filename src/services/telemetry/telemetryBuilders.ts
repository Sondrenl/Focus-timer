import {
  AttemptOutcome,
  PauseInterval,
  SessionAttempt,
} from '../../types/telemetry';
import { SessionType } from '../../types/timer';
import { UserSettings } from '../../types/settings';
import {
  buildLocalTimeContext,
  buildSettingsSnapshot,
  getDeviceClass,
} from '../../utils/telemetryContext';

const MAX_PAUSE_INTERVALS = 50;

export interface ActiveAttemptDraft {
  attempt: SessionAttempt;
  activeSegmentStartMs: number | null;
  accumulatedActiveMs: number;
  currentPauseStartMs: number | null;
  targetEndTimeMs: number | null;
}

export function generateTelemetryId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function toNullableTelemetryId(id?: string | null): string | null {
  return id && id.trim().length > 0 ? id : null;
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
  targetEndTimeMs: number | null;
  nowMs: number;
}): ActiveAttemptDraft {
  const timeCtx = buildLocalTimeContext(params.nowMs);
  const cleanTagId = toNullableTelemetryId(params.tagId);
  const plannedSec = Math.max(1, Math.round(params.plannedDurationSeconds));

  return {
    attempt: {
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
      dailyGoalMinutes: params.dailyGoalMinutes || 120,
      settingsSnapshot: buildSettingsSnapshot(params.settings),
      deviceClass: getDeviceClass(),
      tabBackgroundedCount: 0,
      completionLatencySeconds: null,
      source: 'client',
      updatedAtMs: params.nowMs,
    },
    activeSegmentStartMs: params.nowMs,
    accumulatedActiveMs: 0,
    currentPauseStartMs: null,
    targetEndTimeMs: params.targetEndTimeMs,
  };
}

function closeOpenPause(
  draft: ActiveAttemptDraft,
  nowMs: number
): { totalPausedSeconds: number; pauseIntervals: PauseInterval[] } {
  const updatedPauses = [...draft.attempt.pauseIntervals];
  let totalPausedSeconds = draft.attempt.totalPausedSeconds;
  if (draft.currentPauseStartMs !== null) {
    const pauseSec = Math.max(0, Math.round((nowMs - draft.currentPauseStartMs) / 1000));
    totalPausedSeconds += pauseSec;
    if (updatedPauses.length > 0) {
      const lastIdx = updatedPauses.length - 1;
      updatedPauses[lastIdx] = {
        ...updatedPauses[lastIdx],
        resumedAt: buildLocalTimeContext(nowMs).timestamp,
        durationSeconds: pauseSec,
      };
    }
  }
  return { totalPausedSeconds, pauseIntervals: updatedPauses };
}

export function resumeAttemptDraft(
  draft: ActiveAttemptDraft,
  nowMs: number,
  targetEndTimeMs: number | null
): ActiveAttemptDraft {
  const { totalPausedSeconds, pauseIntervals } = closeOpenPause(draft, nowMs);
  return {
    attempt: {
      ...draft.attempt,
      totalPausedSeconds,
      pauseIntervals,
      updatedAtMs: nowMs,
    },
    activeSegmentStartMs: nowMs,
    accumulatedActiveMs: draft.accumulatedActiveMs,
    currentPauseStartMs: null,
    targetEndTimeMs,
  };
}

export function pauseAttemptDraft(
  draft: ActiveAttemptDraft,
  params: { remainingSeconds: number; tagId?: string | null; nowMs: number }
): ActiveAttemptDraft {
  const segmentMs =
    draft.activeSegmentStartMs !== null ? Math.max(0, params.nowMs - draft.activeSegmentStartMs) : 0;
  const accumulatedActiveMs = draft.accumulatedActiveMs + segmentMs;
  const elapsedActiveSeconds = Math.max(0, Math.round(accumulatedActiveMs / 1000));
  const nextTagId =
    params.tagId !== undefined ? toNullableTelemetryId(params.tagId) : draft.attempt.tagId;

  const pauseEntry: PauseInterval = {
    pausedAt: buildLocalTimeContext(params.nowMs).timestamp,
    elapsedActiveSecondsAtPause: elapsedActiveSeconds,
    remainingSecondsAtPause: Math.max(0, Math.round(params.remainingSeconds)),
  };
  const pauseIntervals =
    draft.attempt.pauseIntervals.length < MAX_PAUSE_INTERVALS
      ? [...draft.attempt.pauseIntervals, pauseEntry]
      : draft.attempt.pauseIntervals;

  return {
    attempt: {
      ...draft.attempt,
      tagId: nextTagId,
      tagChangedMidRun: draft.attempt.tagChangedMidRun || nextTagId !== draft.attempt.initialTagId,
      actualActiveSeconds: elapsedActiveSeconds,
      pauseCount: draft.attempt.pauseCount + 1,
      pauseIntervals,
      updatedAtMs: params.nowMs,
    },
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

  const { totalPausedSeconds, pauseIntervals } = closeOpenPause(draft, params.nowMs);
  const wallActiveSec = Math.round(accumulatedActiveMs / 1000);
  const nominalElapsedSec = Math.max(0, params.plannedSec - params.remainingSec);
  const rawActiveSec = wallActiveSec > 0 ? wallActiveSec : nominalElapsedSec;
  const actualActiveSeconds =
    params.outcome === 'completed'
      ? Math.max(1, wallActiveSec > 0 ? Math.min(wallActiveSec, params.plannedSec) : params.plannedSec)
      : Math.max(0, Math.min(params.plannedSec, rawActiveSec));

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
    completionRatio: Number(Math.min(1, actualActiveSeconds / params.plannedSec).toFixed(4)),
    totalPausedSeconds,
    pauseIntervals,
    completionLatencySeconds:
      params.outcome === 'completed' && effectiveTargetEnd !== null
        ? Math.max(0, Math.round((params.nowMs - effectiveTargetEnd) / 1000))
        : null,
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
    completionRatio: Number(Math.min(1, actualActiveSeconds / params.plannedSec).toFixed(4)),
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

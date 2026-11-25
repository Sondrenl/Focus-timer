import { useCallback } from 'react';
import { SessionType, TimerStatus, RemoteTimerState } from '../../types/timer';
import { SoundService } from '../../services/audio/SoundService';
import { wakeLockService } from '../../services/screen/WakeLockService';
import {
  computeNextInterval,
  computePreviousInterval,
} from '../../utils/timerTransitions';
import {
  getLogicalDayKey,
  getLastResetDayKey,
  setLastResetDayKey,
  NEW_DAY_HOUR_CUTOFF,
  INACTIVITY_THRESHOLD_MS,
} from '../../utils/newDayCheck';
import {
  CompletedSessionFallback,
  ResetTimerOptions,
  TimerSharedRefs,
  TimerSnapshot,
} from './useTimerCloudSync';
import { telemetryTracker } from '../services';

interface UseTimerActionsParams {
  refs: TimerSharedRefs;
  isOnlineAndConnected: () => boolean;
  getServerAlignedNowMs: () => number;
  commitTimerSnapshot: (snapshot: TimerSnapshot) => void;
  setRemainingSeconds: (sec: number) => void;
  getDurationForType: (type: SessionType) => number;
  sound: SoundService;
  dispatchCompletionAlert: (completedSessionType: SessionType, runId?: string | null) => void;
  triggerCompletionConfetti: () => void;
  recordSession: (session: CompletedSessionFallback) => Promise<unknown>;
  publishLocalTimerState: (
    nextState: RemoteTimerState,
    isDirectUserAction?: boolean,
    resetOptions?: ResetTimerOptions
  ) => void;
}

export function useTimerActions({
  refs,
  isOnlineAndConnected,
  getServerAlignedNowMs,
  commitTimerSnapshot,
  setRemainingSeconds,
  getDurationForType,
  sound,
  dispatchCompletionAlert,
  triggerCompletionConfetti,
  recordSession,
  publishLocalTimerState,
}: UseTimerActionsParams) {
  const finalizeActiveRunIfStarted = useCallback(
    (outcome: 'reset' | 'skipped' | 'switched', nowMs: number) => {
      const status = refs.statusRef.current;
      if (status !== 'RUNNING' && status !== 'PAUSED') return;

      const currentRemaining =
        status === 'RUNNING' && refs.targetEndTimeRef.current !== null
          ? Math.max(
              0,
              Math.min(
                refs.totalSecondsRef.current,
                Math.ceil((refs.targetEndTimeRef.current - nowMs) / 1000)
              )
            )
          : refs.remainingSecondsRef.current;

      void telemetryTracker.onSessionFinalized({
        attemptId: refs.timerRunIdRef.current,
        outcome,
        sessionType: refs.sessionTypeRef.current,
        plannedDurationSeconds: refs.totalSecondsRef.current,
        remainingSecondsAtEnd: currentRemaining,
        cycleIndex: refs.currentCycleRef.current,
        tagId: refs.activeTagIdRef.current,
        settings: refs.settingsRef.current,
        dailyGoalMinutes: refs.profileRef.current.dailyGoalMinutes,
        wasStarted: true,
        targetEndTimeMs: refs.targetEndTimeRef.current,
      });
    },
    [refs]
  );

  const ensureResetDayKeyIfPastCutoff = useCallback(() => {
    const wallNow = new Date();
    if (getLastResetDayKey() === null && wallNow.getHours() >= NEW_DAY_HOUR_CUTOFF) {
      setLastResetDayKey(getLogicalDayKey(wallNow));
    }
  }, []);

  // Local completion handler for guest mode (or offline fallback)
  const handleComplete = useCallback(
    (silent = false) => {
      if (isOnlineAndConnected()) {
        // When signed in and connected, Convex onTimerCompleted is authoritative
        refs.remainingSecondsRef.current = 0;
        setRemainingSeconds(0);
        return;
      }

      const completedType = refs.sessionTypeRef.current;
      const currentRunId = refs.timerRunIdRef.current;
      const currentTotal = refs.totalSecondsRef.current;
      const currentCycleVal = refs.currentCycleRef.current;
      const currentTargetEnd = refs.targetEndTimeRef.current;
      const elapsedSeconds = Math.max(1, currentTotal - Math.max(0, refs.remainingSecondsRef.current));

      const { nextType, nextCycle, nextDuration, shouldAutoStart } = computeNextInterval(
        completedType,
        currentCycleVal,
        refs.settingsRef.current
      );

      if (!shouldAutoStart || refs.settingsRef.current.keepAwake === false) {
        wakeLockService.release();
      } else {
        wakeLockService.acquire();
      }

      if (!silent) {
        dispatchCompletionAlert(completedType, currentRunId);
        triggerCompletionConfetti();
      }

      const now = getServerAlignedNowMs();
      const completedTimestampMs =
        currentTargetEnd !== null && currentTargetEnd < now ? currentTargetEnd : now;

      void recordSession({
        tagId: refs.activeTagIdRef.current,
        sessionType: completedType,
        durationSeconds: elapsedSeconds,
        completedAt: new Date(completedTimestampMs).toISOString(),
        timerRunId: currentRunId || undefined,
      }).catch((err) => {
        console.warn('Failed to record completed session:', err);
      });

      void telemetryTracker.onSessionFinalized({
        attemptId: currentRunId,
        outcome: 'completed',
        sessionType: completedType,
        plannedDurationSeconds: currentTotal,
        remainingSecondsAtEnd: 0,
        cycleIndex: currentCycleVal,
        tagId: refs.activeTagIdRef.current,
        settings: refs.settingsRef.current,
        dailyGoalMinutes: refs.profileRef.current.dailyGoalMinutes,
        wasStarted: true,
        targetEndTimeMs: currentTargetEnd,
      });

      ensureResetDayKeyIfPastCutoff();

      const nextTargetEnd = shouldAutoStart ? now + nextDuration * 1000 : null;
      const newRunId =
        shouldAutoStart && nextTargetEnd !== null
          ? `run-${now}-${Math.random().toString(36).substring(2, 7)}`
          : null;
      const nextStatus: TimerStatus = newRunId ? 'RUNNING' : 'IDLE';

      refs.localUpdatedAtRef.current = Math.max(refs.localUpdatedAtRef.current, now);
      commitTimerSnapshot({
        sessionType: nextType,
        status: nextStatus,
        currentCycle: nextCycle,
        totalSeconds: nextDuration,
        remainingSeconds: nextDuration,
        targetEndTime: nextTargetEnd,
        timerRunId: newRunId,
      });

      if (newRunId && nextTargetEnd !== null) {
        void telemetryTracker.onSessionStarted({
          attemptId: newRunId,
          sessionType: nextType,
          plannedDurationSeconds: nextDuration,
          cycleIndex: nextCycle,
          tagId: refs.activeTagIdRef.current,
          autoStarted: true,
          settings: refs.settingsRef.current,
          dailyGoalMinutes: refs.profileRef.current.dailyGoalMinutes,
          targetEndTimeMs: nextTargetEnd,
          nowMs: now,
        });
      }
    },
    [
      refs,
      isOnlineAndConnected,
      getServerAlignedNowMs,
      setRemainingSeconds,
      commitTimerSnapshot,
      ensureResetDayKeyIfPastCutoff,
      recordSession,
      dispatchCompletionAlert,
      triggerCompletionConfetti,
    ]
  );

  const handleStaleExpiration = useCallback(() => {
    wakeLockService.release();

    const staleType = refs.sessionTypeRef.current;
    const staleRunId = refs.timerRunIdRef.current;
    const staleCycle = refs.currentCycleRef.current;
    const staleTargetEnd = refs.targetEndTimeRef.current;

    void telemetryTracker.onSessionFinalized({
      attemptId: staleRunId,
      outcome: 'abandoned_stale',
      sessionType: staleType,
      plannedDurationSeconds: refs.totalSecondsRef.current,
      remainingSecondsAtEnd: refs.remainingSecondsRef.current,
      cycleIndex: staleCycle,
      tagId: refs.activeTagIdRef.current,
      settings: refs.settingsRef.current,
      dailyGoalMinutes: refs.profileRef.current.dailyGoalMinutes,
      wasStarted: true,
      targetEndTimeMs: staleTargetEnd,
    });

    const wallNowMs = Date.now();
    const staleAnchorMs = staleTargetEnd ?? refs.localUpdatedAtRef.current;
    const isFromPreviousDay =
      staleAnchorMs > 0 &&
      getLogicalDayKey(new Date(staleAnchorMs)) !== getLogicalDayKey(new Date(wallNowMs)) &&
      wallNowMs - staleAnchorMs >= INACTIVITY_THRESHOLD_MS;

    const nextSessionType: SessionType = isFromPreviousDay ? 'WORK' : staleType;
    const nextCycle = isFromPreviousDay ? 1 : staleCycle;
    const defaultDuration = getDurationForType(nextSessionType);
    const prevUpdatedAtMs = refs.localUpdatedAtRef.current;
    const nowMs = getServerAlignedNowMs();

    if (isFromPreviousDay) {
      setLastResetDayKey(getLogicalDayKey(new Date(wallNowMs)));
    }

    refs.localUpdatedAtRef.current = nowMs;
    commitTimerSnapshot({
      sessionType: nextSessionType,
      status: 'IDLE',
      currentCycle: nextCycle,
      totalSeconds: defaultDuration,
      remainingSeconds: defaultDuration,
      targetEndTime: null,
      timerRunId: null,
    });

    publishLocalTimerState(
      {
        sessionType: nextSessionType,
        status: 'IDLE',
        remainingSeconds: defaultDuration,
        totalSeconds: defaultDuration,
        targetEndTime: null,
        currentCycle: nextCycle,
        activeTagId: refs.activeTagIdRef.current,
        timerRunId: null,
        updatedAtMs: nowMs,
      },
      false,
      {
        onlyIfNotRunning: !staleRunId,
        expectedTimerRunId: staleRunId || undefined,
        expectedUpdatedAtMs: !staleRunId ? prevUpdatedAtMs : undefined,
      }
    );
  }, [refs, getServerAlignedNowMs, commitTimerSnapshot, getDurationForType, publishLocalTimerState]);

  const start = useCallback(() => {
    if (refs.statusRef.current === 'RUNNING') return;

    sound.prepareForPlayback();
    if (refs.settingsRef.current.keepAwake !== false) {
      wakeLockService.acquire();
    }

    const duration = refs.remainingSecondsRef.current;
    const now = getServerAlignedNowMs();
    const calculatedTargetEnd = now + duration * 1000;
    const wasPaused = refs.statusRef.current === 'PAUSED' && Boolean(refs.timerRunIdRef.current);
    const runId = wasPaused
      ? refs.timerRunIdRef.current!
      : `run-${now}-${Math.random().toString(36).substring(2, 7)}`;

    commitTimerSnapshot({
      status: 'RUNNING',
      remainingSeconds: duration,
      targetEndTime: calculatedTargetEnd,
      timerRunId: runId,
    });

    if (wasPaused) {
      void telemetryTracker.onSessionResumed({ targetEndTimeMs: calculatedTargetEnd, nowMs: now });
    } else {
      void telemetryTracker.onSessionStarted({
        attemptId: runId,
        sessionType: refs.sessionTypeRef.current,
        plannedDurationSeconds: refs.totalSecondsRef.current,
        cycleIndex: refs.currentCycleRef.current,
        tagId: refs.activeTagIdRef.current,
        autoStarted: false,
        settings: refs.settingsRef.current,
        dailyGoalMinutes: refs.profileRef.current.dailyGoalMinutes,
        targetEndTimeMs: calculatedTargetEnd,
        nowMs: now,
      });
    }

    const wallNow = new Date();
    const currentDayKey = getLogicalDayKey(wallNow);
    const existingResetKey = getLastResetDayKey();
    const isFreshWorkCycleOne =
      !wasPaused && refs.sessionTypeRef.current === 'WORK' && refs.currentCycleRef.current === 1;
    if (
      existingResetKey !== currentDayKey &&
      (isFreshWorkCycleOne || (existingResetKey === null && wallNow.getHours() >= NEW_DAY_HOUR_CUTOFF))
    ) {
      setLastResetDayKey(currentDayKey);
    }

    publishLocalTimerState(
      {
        sessionType: refs.sessionTypeRef.current,
        status: 'RUNNING',
        remainingSeconds: duration,
        totalSeconds: refs.totalSecondsRef.current,
        targetEndTime: calculatedTargetEnd,
        currentCycle: refs.currentCycleRef.current,
        activeTagId: refs.activeTagIdRef.current,
        timerRunId: runId,
        updatedAtMs: now,
      },
      true
    );
  }, [refs, getServerAlignedNowMs, commitTimerSnapshot, sound, publishLocalTimerState]);

  const pause = useCallback(() => {
    if (refs.statusRef.current !== 'RUNNING') return;

    const now = getServerAlignedNowMs();
    let currentRemaining = refs.remainingSecondsRef.current;
    if (refs.targetEndTimeRef.current !== null) {
      const diffMs = refs.targetEndTimeRef.current - now;
      if (diffMs <= 0) {
        if (diffMs < -900_000) {
          handleStaleExpiration();
          return;
        }
        refs.remainingSecondsRef.current = 0;
        setRemainingSeconds(0);
        handleComplete(false);
        return;
      }
      currentRemaining = Math.max(
        1,
        Math.min(refs.totalSecondsRef.current, Math.ceil(diffMs / 1000))
      );
    }

    wakeLockService.release();

    commitTimerSnapshot({
      status: 'PAUSED',
      remainingSeconds: currentRemaining,
      targetEndTime: null,
      timerRunId: refs.timerRunIdRef.current,
    });

    void telemetryTracker.onSessionPaused({
      remainingSeconds: currentRemaining,
      tagId: refs.activeTagIdRef.current,
      nowMs: now,
    });

    publishLocalTimerState(
      {
        sessionType: refs.sessionTypeRef.current,
        status: 'PAUSED',
        remainingSeconds: currentRemaining,
        totalSeconds: refs.totalSecondsRef.current,
        targetEndTime: null,
        currentCycle: refs.currentCycleRef.current,
        activeTagId: refs.activeTagIdRef.current,
        timerRunId: refs.timerRunIdRef.current,
        updatedAtMs: now,
      },
      true
    );
  }, [
    refs,
    getServerAlignedNowMs,
    handleComplete,
    handleStaleExpiration,
    setRemainingSeconds,
    commitTimerSnapshot,
    publishLocalTimerState,
  ]);

  const transitionToIdleInterval = useCallback(
    (
      nextType: SessionType,
      nextCycle: number,
      nextDuration: number,
      outcome: 'reset' | 'skipped' | 'switched'
    ) => {
      wakeLockService.release();
      const nowMs = getServerAlignedNowMs();
      finalizeActiveRunIfStarted(outcome, nowMs);
      ensureResetDayKeyIfPastCutoff();

      commitTimerSnapshot({
        sessionType: nextType,
        status: 'IDLE',
        currentCycle: nextCycle,
        totalSeconds: nextDuration,
        remainingSeconds: nextDuration,
        targetEndTime: null,
        timerRunId: null,
      });

      publishLocalTimerState(
        {
          sessionType: nextType,
          status: 'IDLE',
          remainingSeconds: nextDuration,
          totalSeconds: nextDuration,
          targetEndTime: null,
          currentCycle: nextCycle,
          activeTagId: refs.activeTagIdRef.current,
          timerRunId: null,
          updatedAtMs: nowMs,
        },
        true
      );
    },
    [
      refs,
      getServerAlignedNowMs,
      finalizeActiveRunIfStarted,
      ensureResetDayKeyIfPastCutoff,
      commitTimerSnapshot,
      publishLocalTimerState,
    ]
  );

  const reset = useCallback(() => {
    const type = refs.sessionTypeRef.current;
    transitionToIdleInterval(type, refs.currentCycleRef.current, getDurationForType(type), 'reset');
  }, [refs, getDurationForType, transitionToIdleInterval]);

  const skip = useCallback(() => {
    const { nextType, nextCycle, nextDuration } = computeNextInterval(
      refs.sessionTypeRef.current,
      refs.currentCycleRef.current,
      refs.settingsRef.current
    );
    transitionToIdleInterval(nextType, nextCycle, nextDuration, 'skipped');
  }, [refs, transitionToIdleInterval]);

  const previousInterval = useCallback(() => {
    const { previousType, previousCycle, previousDuration } = computePreviousInterval(
      refs.sessionTypeRef.current,
      refs.currentCycleRef.current,
      refs.settingsRef.current
    );
    transitionToIdleInterval(previousType, previousCycle, previousDuration, 'switched');
  }, [refs, transitionToIdleInterval]);

  const toggleStartPause = useCallback(() => {
    if (refs.statusRef.current === 'RUNNING') pause();
    else start();
  }, [refs, pause, start]);

  return {
    handleComplete,
    handleStaleExpiration,
    start,
    pause,
    reset,
    skip,
    previousInterval,
    toggleStartPause,
  };
}

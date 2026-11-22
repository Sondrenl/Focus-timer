import React, { useCallback } from 'react';
import { SessionType, TimerStatus, RemoteTimerState } from '../../types/timer';
import { UserSettings } from '../../types/settings';
import { CoffeeCup } from '../../types/coffee';
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
import { ResetTimerOptions } from './useTimerCloudSync';
import { telemetryTracker } from '../services';

interface UseTimerActionsParams {
  sessionTypeRef: React.MutableRefObject<SessionType>;
  statusRef: React.MutableRefObject<TimerStatus>;
  currentCycleRef: React.MutableRefObject<number>;
  totalSecondsRef: React.MutableRefObject<number>;
  remainingSecondsRef: React.MutableRefObject<number>;
  targetEndTimeRef: React.MutableRefObject<number | null>;
  timerRunIdRef: React.MutableRefObject<string | null>;
  localUpdatedAtRef: React.MutableRefObject<number>;
  activeTagIdRef: React.MutableRefObject<string | null>;
  settingsRef: React.MutableRefObject<UserSettings>;
  profileRef: React.MutableRefObject<{ dailyGoalMinutes: number }>;
  coffeeCupsRef: React.MutableRefObject<CoffeeCup[]>;
  getServerAlignedNowMs: () => number;
  setSessionType: React.Dispatch<React.SetStateAction<SessionType>>;
  setStatus: React.Dispatch<React.SetStateAction<TimerStatus>>;
  setCurrentCycle: React.Dispatch<React.SetStateAction<number>>;
  setTotalSeconds: React.Dispatch<React.SetStateAction<number>>;
  setRemainingSeconds: React.Dispatch<React.SetStateAction<number>>;
  setTargetEndTime: React.Dispatch<React.SetStateAction<number | null>>;
  getDurationForType: (type: SessionType) => number;
  recordSession: (session: {
    tagId: string | null;
    sessionType: SessionType;
    durationSeconds: number;
    completedAt: string;
    timerRunId?: string | null;
  }) => Promise<unknown>;
  sound: SoundService;
  dispatchCompletionAlert: (completedSessionType: SessionType, runId?: string | null) => void;
  triggerCompletionConfetti: () => void;
  publishLocalTimerState: (
    nextState: RemoteTimerState,
    isDirectUserAction?: boolean,
    resetOptions?: ResetTimerOptions
  ) => void;
  publishTimerCompletion: (
    nextState: RemoteTimerState,
    completedTimerRunId: string | null,
    completedSessionFallback?: {
      tagId: string | null;
      sessionType: SessionType;
      durationSeconds: number;
      completedAt: string;
      timerRunId?: string | null;
    }
  ) => void;
}

export function useTimerActions({
  sessionTypeRef,
  statusRef,
  currentCycleRef,
  totalSecondsRef,
  remainingSecondsRef,
  targetEndTimeRef,
  timerRunIdRef,
  localUpdatedAtRef,
  activeTagIdRef,
  settingsRef,
  profileRef,
  coffeeCupsRef,
  getServerAlignedNowMs,
  setSessionType,
  setStatus,
  setCurrentCycle,
  setTotalSeconds,
  setRemainingSeconds,
  setTargetEndTime,
  getDurationForType,
  sound,
  dispatchCompletionAlert,
  triggerCompletionConfetti,
  publishLocalTimerState,
  publishTimerCompletion,
}: UseTimerActionsParams) {
  const handleComplete = useCallback(
    (silent = false) => {
      const completedType = sessionTypeRef.current;
      const currentRunId = timerRunIdRef.current;
      const currentRemaining = remainingSecondsRef.current;
      const currentTotal = totalSecondsRef.current;
      const currentCycleVal = currentCycleRef.current;
      const currentTargetEnd = targetEndTimeRef.current;

      const elapsedSeconds = Math.max(1, currentTotal - Math.max(0, currentRemaining));

      const { nextType, nextCycle, nextDuration, shouldAutoStart } = computeNextInterval(
        completedType,
        currentCycleVal,
        settingsRef.current
      );

      // Keep Wake Lock alive across auto-started transitions (status remains RUNNING so useTimerWorker's effect won't re-acquire)
      if (!shouldAutoStart || settingsRef.current.keepAwake === false) {
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
        currentTargetEnd !== null && currentTargetEnd < now
          ? currentTargetEnd
          : now;

      const completedSessionFallback = {
        tagId: activeTagIdRef.current,
        sessionType: completedType,
        durationSeconds: elapsedSeconds,
        completedAt: new Date(completedTimestampMs).toISOString(),
        timerRunId: currentRunId || undefined,
      };

      void telemetryTracker.onSessionFinalized({
        attemptId: currentRunId,
        outcome: 'completed',
        sessionType: completedType,
        plannedDurationSeconds: currentTotal,
        remainingSecondsAtEnd: 0,
        cycleIndex: currentCycleVal,
        tagId: activeTagIdRef.current,
        settings: settingsRef.current,
        dailyGoalMinutes: profileRef.current.dailyGoalMinutes,
        coffeeCups: coffeeCupsRef.current,
        wasStarted: true,
        targetEndTimeMs: currentTargetEnd,
      });

      // Only stamp the reset key on first-ever completion after 04:00 AM; never overwrite an
      // older logical day's key during an all-nighter carryover past 04:00 AM so post-all-nighter
      // sleep (>1h) still triggers a clean reset to WORK Cycle 1.
      const wallNow = new Date();
      if (getLastResetDayKey() === null && wallNow.getHours() >= NEW_DAY_HOUR_CUTOFF) {
        setLastResetDayKey(getLogicalDayKey(wallNow));
      }

      const nextTargetEnd = shouldAutoStart ? now + nextDuration * 1000 : null;
      sessionTypeRef.current = nextType;
      currentCycleRef.current = nextCycle;
      totalSecondsRef.current = nextDuration;
      targetEndTimeRef.current = nextTargetEnd;

      setSessionType(nextType);
      setCurrentCycle(nextCycle);
      setTotalSeconds(nextDuration);
      setTargetEndTime(nextTargetEnd);

      if (shouldAutoStart && nextTargetEnd !== null) {
        const newRunId = `run-${now}-${Math.random().toString(36).substring(2, 7)}`;
        timerRunIdRef.current = newRunId;
        statusRef.current = 'RUNNING';
        remainingSecondsRef.current = nextDuration;
        setStatus('RUNNING');
        setRemainingSeconds(nextDuration);

        void telemetryTracker.onSessionStarted({
          attemptId: newRunId,
          sessionType: nextType,
          plannedDurationSeconds: nextDuration,
          cycleIndex: nextCycle,
          tagId: activeTagIdRef.current,
          autoStarted: true,
          settings: settingsRef.current,
          dailyGoalMinutes: profileRef.current.dailyGoalMinutes,
          coffeeCups: coffeeCupsRef.current,
          targetEndTimeMs: nextTargetEnd,
          nowMs: now,
        });

        publishTimerCompletion(
          {
            sessionType: nextType,
            status: 'RUNNING',
            remainingSeconds: nextDuration,
            totalSeconds: nextDuration,
            targetEndTime: nextTargetEnd,
            currentCycle: nextCycle,
            activeTagId: activeTagIdRef.current,
            timerRunId: newRunId,
            lastCompletedTimerRunId: currentRunId,
            updatedAtMs: now,
          },
          currentRunId,
          completedSessionFallback
        );
      } else {
        timerRunIdRef.current = null;
        statusRef.current = 'IDLE';
        remainingSecondsRef.current = nextDuration;
        setStatus('IDLE');
        setRemainingSeconds(nextDuration);

        publishTimerCompletion(
          {
            sessionType: nextType,
            status: 'IDLE',
            remainingSeconds: nextDuration,
            totalSeconds: nextDuration,
            targetEndTime: null,
            currentCycle: nextCycle,
            activeTagId: activeTagIdRef.current,
            timerRunId: null,
            lastCompletedTimerRunId: currentRunId,
            updatedAtMs: now,
          },
          currentRunId,
          completedSessionFallback
        );
      }
    },
    [
      sessionTypeRef,
      timerRunIdRef,
      remainingSecondsRef,
      totalSecondsRef,
      currentCycleRef,
      targetEndTimeRef,
      activeTagIdRef,
      settingsRef,
      profileRef,
      coffeeCupsRef,
      statusRef,
      getServerAlignedNowMs,
      setSessionType,
      setCurrentCycle,
      setTotalSeconds,
      setTargetEndTime,
      setStatus,
      setRemainingSeconds,
      publishTimerCompletion,
      dispatchCompletionAlert,
      triggerCompletionConfetti,
    ]
  );

  const handleStaleExpiration = useCallback(() => {
    wakeLockService.release();

    const staleType = sessionTypeRef.current;
    const staleRunId = timerRunIdRef.current;
    const staleTotal = totalSecondsRef.current;
    const staleRemaining = remainingSecondsRef.current;
    const staleCycle = currentCycleRef.current;
    const staleTargetEnd = targetEndTimeRef.current;

    void telemetryTracker.onSessionFinalized({
      attemptId: staleRunId,
      outcome: 'abandoned_stale',
      sessionType: staleType,
      plannedDurationSeconds: staleTotal,
      remainingSecondsAtEnd: staleRemaining,
      cycleIndex: staleCycle,
      tagId: activeTagIdRef.current,
      settings: settingsRef.current,
      dailyGoalMinutes: profileRef.current.dailyGoalMinutes,
      coffeeCups: coffeeCupsRef.current,
      wasStarted: true,
      targetEndTimeMs: staleTargetEnd,
    });

    const wallNowMs = Date.now();
    const staleAnchorMs = staleTargetEnd ?? localUpdatedAtRef.current;
    const isFromPreviousDay =
      staleAnchorMs > 0 &&
      getLogicalDayKey(new Date(staleAnchorMs)) !== getLogicalDayKey(new Date(wallNowMs)) &&
      wallNowMs - staleAnchorMs >= INACTIVITY_THRESHOLD_MS;

    const nextSessionType: SessionType = isFromPreviousDay ? 'WORK' : staleType;
    const nextCycle = isFromPreviousDay ? 1 : staleCycle;
    const defaultDuration = getDurationForType(nextSessionType);
    const prevUpdatedAtMs = localUpdatedAtRef.current;
    const nowMs = getServerAlignedNowMs();

    if (isFromPreviousDay) {
      sessionTypeRef.current = 'WORK';
      currentCycleRef.current = 1;
      setSessionType('WORK');
      setCurrentCycle(1);
      setLastResetDayKey(getLogicalDayKey(new Date(wallNowMs)));
    }

    statusRef.current = 'IDLE';
    targetEndTimeRef.current = null;
    timerRunIdRef.current = null;
    totalSecondsRef.current = defaultDuration;
    remainingSecondsRef.current = defaultDuration;
    localUpdatedAtRef.current = nowMs;

    setStatus('IDLE');
    setTargetEndTime(null);
    setTotalSeconds(defaultDuration);
    setRemainingSeconds(defaultDuration);

    publishLocalTimerState(
      {
        sessionType: nextSessionType,
        status: 'IDLE',
        remainingSeconds: defaultDuration,
        totalSeconds: defaultDuration,
        targetEndTime: null,
        currentCycle: nextCycle,
        activeTagId: activeTagIdRef.current,
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
  }, [
    sessionTypeRef,
    timerRunIdRef,
    totalSecondsRef,
    remainingSecondsRef,
    currentCycleRef,
    targetEndTimeRef,
    activeTagIdRef,
    settingsRef,
    profileRef,
    coffeeCupsRef,
    statusRef,
    localUpdatedAtRef,
    getServerAlignedNowMs,
    setSessionType,
    setCurrentCycle,
    setStatus,
    setTargetEndTime,
    setTotalSeconds,
    setRemainingSeconds,
    getDurationForType,
    publishLocalTimerState,
  ]);

  const start = useCallback(() => {
    if (statusRef.current === 'RUNNING') return;

    sound.prepareForPlayback();
    if (settingsRef.current.keepAwake !== false) {
      wakeLockService.acquire();
    }

    const duration = remainingSecondsRef.current;
    const now = getServerAlignedNowMs();
    const calculatedTargetEnd = now + duration * 1000;
    const wasPaused = statusRef.current === 'PAUSED' && Boolean(timerRunIdRef.current);
    const runId = wasPaused
      ? timerRunIdRef.current!
      : `run-${now}-${Math.random().toString(36).substring(2, 7)}`;

    targetEndTimeRef.current = calculatedTargetEnd;
    timerRunIdRef.current = runId;
    statusRef.current = 'RUNNING';

    setTargetEndTime(calculatedTargetEnd);
    setStatus('RUNNING');

    if (wasPaused) {
      void telemetryTracker.onSessionResumed({
        targetEndTimeMs: calculatedTargetEnd,
        nowMs: now,
      });
    } else {
      void telemetryTracker.onSessionStarted({
        attemptId: runId,
        sessionType: sessionTypeRef.current,
        plannedDurationSeconds: totalSecondsRef.current,
        cycleIndex: currentCycleRef.current,
        tagId: activeTagIdRef.current,
        autoStarted: false,
        settings: settingsRef.current,
        dailyGoalMinutes: profileRef.current.dailyGoalMinutes,
        coffeeCups: coffeeCupsRef.current,
        targetEndTimeMs: calculatedTargetEnd,
        nowMs: now,
      });
    }

    // Stamp the logical day key when starting a fresh WORK Cycle 1 (or on first-ever start
    // after 04:00 AM), but do NOT stamp when continuing an all-nighter break/later cycle past
    // 04:00 AM so post-all-nighter sleep (>1h) still triggers a clean reset to WORK Cycle 1.
    const wallNow = new Date();
    const currentDayKey = getLogicalDayKey(wallNow);
    const existingResetKey = getLastResetDayKey();
    const isFreshWorkCycleOne =
      !wasPaused && sessionTypeRef.current === 'WORK' && currentCycleRef.current === 1;
    if (
      existingResetKey !== currentDayKey &&
      (isFreshWorkCycleOne || (existingResetKey === null && wallNow.getHours() >= NEW_DAY_HOUR_CUTOFF))
    ) {
      setLastResetDayKey(currentDayKey);
    }

    publishLocalTimerState(
      {
        sessionType: sessionTypeRef.current,
        status: 'RUNNING',
        remainingSeconds: duration,
        totalSeconds: totalSecondsRef.current,
        targetEndTime: calculatedTargetEnd,
        currentCycle: currentCycleRef.current,
        activeTagId: activeTagIdRef.current,
        timerRunId: runId,
        updatedAtMs: now,
      },
      true
    );
  }, [
    statusRef,
    settingsRef,
    remainingSecondsRef,
    timerRunIdRef,
    targetEndTimeRef,
    sessionTypeRef,
    totalSecondsRef,
    currentCycleRef,
    activeTagIdRef,
    profileRef,
    coffeeCupsRef,
    getServerAlignedNowMs,
    setTargetEndTime,
    setStatus,
    sound,
    publishLocalTimerState,
  ]);

  const pause = useCallback(() => {
    if (statusRef.current !== 'RUNNING') return;

    const now = getServerAlignedNowMs();
    let currentRemaining = remainingSecondsRef.current;
    if (targetEndTimeRef.current !== null) {
      const diffMs = targetEndTimeRef.current - now;
      if (diffMs <= 0) {
        if (diffMs < -900_000) {
          handleStaleExpiration();
          return;
        }
        remainingSecondsRef.current = 0;
        setRemainingSeconds(0);
        handleComplete(false);
        return;
      }
      currentRemaining = Math.max(
        1,
        Math.min(totalSecondsRef.current, Math.ceil(diffMs / 1000))
      );
    }

    wakeLockService.release();

    targetEndTimeRef.current = null;
    statusRef.current = 'PAUSED';
    remainingSecondsRef.current = currentRemaining;

    setTargetEndTime(null);
    setStatus('PAUSED');
    setRemainingSeconds(currentRemaining);

    void telemetryTracker.onSessionPaused({
      remainingSeconds: currentRemaining,
      tagId: activeTagIdRef.current,
      nowMs: now,
    });

    publishLocalTimerState(
      {
        sessionType: sessionTypeRef.current,
        status: 'PAUSED',
        remainingSeconds: currentRemaining,
        totalSeconds: totalSecondsRef.current,
        targetEndTime: null,
        currentCycle: currentCycleRef.current,
        activeTagId: activeTagIdRef.current,
        timerRunId: timerRunIdRef.current,
        updatedAtMs: now,
      },
      true
    );
  }, [
    statusRef,
    remainingSecondsRef,
    targetEndTimeRef,
    activeTagIdRef,
    sessionTypeRef,
    totalSecondsRef,
    currentCycleRef,
    timerRunIdRef,
    getServerAlignedNowMs,
    handleComplete,
    handleStaleExpiration,
    setTargetEndTime,
    setStatus,
    setRemainingSeconds,
    publishLocalTimerState,
  ]);

  const reset = useCallback(() => {
    wakeLockService.release();

    const nowMs = getServerAlignedNowMs();
    const wasStarted = statusRef.current === 'RUNNING' || statusRef.current === 'PAUSED';
    if (wasStarted) {
      const currentRemaining =
        statusRef.current === 'RUNNING' && targetEndTimeRef.current !== null
          ? Math.max(0, Math.min(totalSecondsRef.current, Math.ceil((targetEndTimeRef.current - nowMs) / 1000)))
          : remainingSecondsRef.current;

      void telemetryTracker.onSessionFinalized({
        attemptId: timerRunIdRef.current,
        outcome: 'reset',
        sessionType: sessionTypeRef.current,
        plannedDurationSeconds: totalSecondsRef.current,
        remainingSecondsAtEnd: currentRemaining,
        cycleIndex: currentCycleRef.current,
        tagId: activeTagIdRef.current,
        settings: settingsRef.current,
        dailyGoalMinutes: profileRef.current.dailyGoalMinutes,
        coffeeCups: coffeeCupsRef.current,
        wasStarted: true,
        targetEndTimeMs: targetEndTimeRef.current,
      });
    }

    const wallNow = new Date();
    if (getLastResetDayKey() === null && wallNow.getHours() >= NEW_DAY_HOUR_CUTOFF) {
      setLastResetDayKey(getLogicalDayKey(wallNow));
    }

    const defaultDuration = getDurationForType(sessionTypeRef.current);
    targetEndTimeRef.current = null;
    timerRunIdRef.current = null;
    statusRef.current = 'IDLE';
    remainingSecondsRef.current = defaultDuration;
    totalSecondsRef.current = defaultDuration;

    setTargetEndTime(null);
    setStatus('IDLE');
    setRemainingSeconds(defaultDuration);
    setTotalSeconds(defaultDuration);

    publishLocalTimerState(
      {
        sessionType: sessionTypeRef.current,
        status: 'IDLE',
        remainingSeconds: defaultDuration,
        totalSeconds: defaultDuration,
        targetEndTime: null,
        currentCycle: currentCycleRef.current,
        activeTagId: activeTagIdRef.current,
        timerRunId: null,
        updatedAtMs: nowMs,
      },
      true
    );
  }, [
    statusRef,
    targetEndTimeRef,
    remainingSecondsRef,
    timerRunIdRef,
    sessionTypeRef,
    totalSecondsRef,
    currentCycleRef,
    activeTagIdRef,
    settingsRef,
    profileRef,
    coffeeCupsRef,
    getServerAlignedNowMs,
    setTargetEndTime,
    setStatus,
    setRemainingSeconds,
    setTotalSeconds,
    getDurationForType,
    publishLocalTimerState,
  ]);

  const transitionToIdleInterval = useCallback(
    (
      nextType: SessionType,
      nextCycle: number,
      nextDuration: number,
      outcome: 'skipped' | 'switched'
    ) => {
      wakeLockService.release();

      const nowMs = getServerAlignedNowMs();
      const wasStarted = statusRef.current === 'RUNNING' || statusRef.current === 'PAUSED';
      if (wasStarted) {
        const currentRemaining =
          statusRef.current === 'RUNNING' && targetEndTimeRef.current !== null
            ? Math.max(0, Math.min(totalSecondsRef.current, Math.ceil((targetEndTimeRef.current - nowMs) / 1000)))
            : remainingSecondsRef.current;

        void telemetryTracker.onSessionFinalized({
          attemptId: timerRunIdRef.current,
          outcome,
          sessionType: sessionTypeRef.current,
          plannedDurationSeconds: totalSecondsRef.current,
          remainingSecondsAtEnd: currentRemaining,
          cycleIndex: currentCycleRef.current,
          tagId: activeTagIdRef.current,
          settings: settingsRef.current,
          dailyGoalMinutes: profileRef.current.dailyGoalMinutes,
          coffeeCups: coffeeCupsRef.current,
          wasStarted: true,
          targetEndTimeMs: targetEndTimeRef.current,
        });
      }

      // Stamp the logical day key for first-time / post-clear users who manually navigate
      // intervals so the 60s new-day check does not undo their Skip/Switch back to WORK Cycle 1.
      const wallNow = new Date();
      if (getLastResetDayKey() === null && wallNow.getHours() >= NEW_DAY_HOUR_CUTOFF) {
        setLastResetDayKey(getLogicalDayKey(wallNow));
      }

      targetEndTimeRef.current = null;
      timerRunIdRef.current = null;
      sessionTypeRef.current = nextType;
      currentCycleRef.current = nextCycle;
      statusRef.current = 'IDLE';
      remainingSecondsRef.current = nextDuration;
      totalSecondsRef.current = nextDuration;

      setSessionType(nextType);
      setCurrentCycle(nextCycle);
      setStatus('IDLE');
      setRemainingSeconds(nextDuration);
      setTotalSeconds(nextDuration);
      setTargetEndTime(null);

      publishLocalTimerState(
        {
          sessionType: nextType,
          status: 'IDLE',
          remainingSeconds: nextDuration,
          totalSeconds: nextDuration,
          targetEndTime: null,
          currentCycle: nextCycle,
          activeTagId: activeTagIdRef.current,
          timerRunId: null,
          updatedAtMs: nowMs,
        },
        true
      );
    },
    [
      statusRef,
      targetEndTimeRef,
      remainingSecondsRef,
      timerRunIdRef,
      sessionTypeRef,
      totalSecondsRef,
      currentCycleRef,
      activeTagIdRef,
      settingsRef,
      profileRef,
      coffeeCupsRef,
      getServerAlignedNowMs,
      setSessionType,
      setCurrentCycle,
      setStatus,
      setRemainingSeconds,
      setTotalSeconds,
      setTargetEndTime,
      publishLocalTimerState,
    ]
  );

  const skip = useCallback(() => {
    const { nextType, nextCycle, nextDuration } = computeNextInterval(
      sessionTypeRef.current,
      currentCycleRef.current,
      settingsRef.current
    );
    transitionToIdleInterval(nextType, nextCycle, nextDuration, 'skipped');
  }, [sessionTypeRef, currentCycleRef, settingsRef, transitionToIdleInterval]);

  const previousInterval = useCallback(() => {
    const { previousType, previousCycle, previousDuration } = computePreviousInterval(
      sessionTypeRef.current,
      currentCycleRef.current,
      settingsRef.current
    );
    transitionToIdleInterval(previousType, previousCycle, previousDuration, 'switched');
  }, [sessionTypeRef, currentCycleRef, settingsRef, transitionToIdleInterval]);

  const toggleStartPause = useCallback(() => {
    if (statusRef.current === 'RUNNING') {
      pause();
    } else {
      start();
    }
  }, [statusRef, pause, start]);

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

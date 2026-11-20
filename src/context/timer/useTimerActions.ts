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
    completedTimerRunId: string | null
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
  setSessionType,
  setStatus,
  setCurrentCycle,
  setTotalSeconds,
  setRemainingSeconds,
  setTargetEndTime,
  getDurationForType,
  recordSession,
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

      wakeLockService.release();

      if (!silent) {
        dispatchCompletionAlert(completedType, currentRunId);
        triggerCompletionConfetti();
      }

      const completedTimestampMs =
        currentTargetEnd !== null && currentTargetEnd < Date.now()
          ? currentTargetEnd
          : Date.now();

      void recordSession({
        tagId: activeTagIdRef.current,
        sessionType: completedType,
        durationSeconds: elapsedSeconds,
        completedAt: new Date(completedTimestampMs).toISOString(),
      });

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

      const completionDayKey = getLogicalDayKey(new Date());
      if (getLastResetDayKey() !== completionDayKey) {
        setLastResetDayKey(completionDayKey);
      }

      const { nextType, nextCycle, nextDuration, shouldAutoStart } = computeNextInterval(
        completedType,
        currentCycleVal,
        settingsRef.current
      );

      const now = Date.now();
      sessionTypeRef.current = nextType;
      currentCycleRef.current = nextCycle;
      totalSecondsRef.current = nextDuration;
      targetEndTimeRef.current = shouldAutoStart ? now + nextDuration * 1000 : null;

      setSessionType(nextType);
      setCurrentCycle(nextCycle);
      setTotalSeconds(nextDuration);
      setTargetEndTime(shouldAutoStart ? now + nextDuration * 1000 : null);

      if (shouldAutoStart) {
        const newRunId = `run-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const nextTargetEnd = now + nextDuration * 1000;
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
            updatedAtMs: now,
          },
          currentRunId
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
            updatedAtMs: now,
          },
          currentRunId
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
      setSessionType,
      setCurrentCycle,
      setTotalSeconds,
      setTargetEndTime,
      setStatus,
      setRemainingSeconds,
      recordSession,
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

    const defaultDuration = getDurationForType(staleType);
    const prevUpdatedAtMs = localUpdatedAtRef.current;
    const nowMs = Date.now();
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
        sessionType: staleType,
        status: 'IDLE',
        remainingSeconds: defaultDuration,
        totalSeconds: defaultDuration,
        targetEndTime: null,
        currentCycle: currentCycleRef.current,
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
    const now = Date.now();
    const calculatedTargetEnd = now + duration * 1000;
    const wasPaused = statusRef.current === 'PAUSED' && Boolean(timerRunIdRef.current);
    const runId = wasPaused
      ? timerRunIdRef.current!
      : `run-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

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

    const currentDayKey = getLogicalDayKey(new Date());
    if (getLastResetDayKey() !== currentDayKey) {
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
    setTargetEndTime,
    setStatus,
    sound,
    publishLocalTimerState,
  ]);

  const pause = useCallback(() => {
    if (statusRef.current !== 'RUNNING') return;

    wakeLockService.release();

    const now = Date.now();
    let currentRemaining = remainingSecondsRef.current;
    if (targetEndTimeRef.current !== null) {
      const diffMs = targetEndTimeRef.current - now;
      currentRemaining = Math.max(1, Math.ceil(diffMs / 1000));
    }

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
    setTargetEndTime,
    setStatus,
    setRemainingSeconds,
    publishLocalTimerState,
  ]);

  const reset = useCallback(() => {
    wakeLockService.release();

    const wasStarted = statusRef.current === 'RUNNING' || statusRef.current === 'PAUSED';
    if (wasStarted) {
      const now = Date.now();
      const currentRemaining =
        statusRef.current === 'RUNNING' && targetEndTimeRef.current !== null
          ? Math.max(0, Math.ceil((targetEndTimeRef.current - now) / 1000))
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

    const nowMs = Date.now();
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

      const wasStarted = statusRef.current === 'RUNNING' || statusRef.current === 'PAUSED';
      if (wasStarted) {
        const now = Date.now();
        const currentRemaining =
          statusRef.current === 'RUNNING' && targetEndTimeRef.current !== null
            ? Math.max(0, Math.ceil((targetEndTimeRef.current - now) / 1000))
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

      const nowMs = Date.now();
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

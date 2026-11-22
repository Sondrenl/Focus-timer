import React, { useCallback, useEffect } from 'react';
import { SessionType, TimerStatus, RemoteTimerState } from '../../types/timer';
import { UserSettings } from '../../types/settings';
import { CoffeeCup } from '../../types/coffee';
import { CompletedSession } from '../../types/session';
import { TAB_ID } from '../../services/timer/TimerBroadcast';
import { wakeLockService } from '../../services/screen/WakeLockService';
import {
  shouldResetForNewDay,
  getLogicalDayKey,
  getLastResetDayKey,
  setLastResetDayKey,
  getLastSessionCompletedAt,
  INACTIVITY_THRESHOLD_MS,
} from '../../utils/newDayCheck';
import { DEVICE_ID, SavedTimerState, saveTimerState } from './timerPersistence';
import { ResetTimerOptions } from './useTimerCloudSync';
import { telemetryTracker } from '../services';

interface UseTimerNewDayResetParams {
  sessions: CompletedSession[];
  convexSessions: unknown;
  isConvexConfigured: boolean;
  hasResolvedRemoteTimer: boolean;
  isAuthenticatedRef: React.MutableRefObject<boolean>;
  hasResolvedRemoteTimerRef: React.MutableRefObject<boolean>;
  remoteTimerRef: React.MutableRefObject<any>;
  statusRef: React.MutableRefObject<TimerStatus>;
  sessionTypeRef: React.MutableRefObject<SessionType>;
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
  publishLocalTimerState: (
    nextState: RemoteTimerState,
    isDirectUserAction?: boolean,
    resetOptions?: ResetTimerOptions
  ) => void;
}

export function useTimerNewDayReset({
  sessions,
  convexSessions,
  isConvexConfigured,
  hasResolvedRemoteTimer,
  isAuthenticatedRef,
  hasResolvedRemoteTimerRef,
  remoteTimerRef,
  statusRef,
  sessionTypeRef,
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
  publishLocalTimerState,
}: UseTimerNewDayResetParams) {
  const checkAndResetForNewDay = useCallback(() => {
    if (statusRef.current === 'RUNNING') return false;

    if (
      isConvexConfigured &&
      isAuthenticatedRef.current &&
      (!hasResolvedRemoteTimer || !hasResolvedRemoteTimerRef.current || convexSessions === undefined)
    ) {
      return false;
    }

    const latestRemote = remoteTimerRef.current;
    if (latestRemote && latestRemote.status === 'RUNNING') {
      return false;
    }

    const now = new Date();
    const currentDayKey = getLogicalDayKey(now);
    if (latestRemote && getLogicalDayKey(latestRemote.updatedAtMs) === currentDayKey) {
      const remoteIsAlreadyFresh =
        latestRemote.status === 'IDLE' &&
        latestRemote.sessionType === 'WORK' &&
        latestRemote.currentCycle === 1;
      if (remoteIsAlreadyFresh) {
        if (getLastResetDayKey() !== currentDayKey) {
          setLastResetDayKey(currentDayKey);
        }
        return false;
      }
      // If another device had activity within the last hour (e.g., active all-nighter past 04:00
      // or recent break/cycle transition), defer reset WITHOUT stamping currentDayKey so a later
      // >1h sleep still resets to WORK Cycle 1.
      if (now.getTime() - latestRemote.updatedAtMs < INACTIVITY_THRESHOLD_MS) {
        return false;
      }
    }

    if (statusRef.current === 'PAUSED' || latestRemote?.status === 'PAUSED') {
      const pausedAtMs = Math.max(localUpdatedAtRef.current, latestRemote?.updatedAtMs ?? 0);
      if (pausedAtMs > 0 && now.getTime() - pausedAtMs < INACTIVITY_THRESHOLD_MS) {
        return false;
      }
    }

    const latestSessionTime = getLastSessionCompletedAt(sessions);
    const lastResetKey = getLastResetDayKey();

    if (
      shouldResetForNewDay({
        now,
        lastSessionTimeMs: latestSessionTime,
        lastResetDayKey: lastResetKey,
        isTimerRunning: false,
      })
    ) {
      if (statusRef.current === 'PAUSED' || latestRemote?.status === 'PAUSED') {
        const pausedAttemptId = timerRunIdRef.current || latestRemote?.timerRunId || null;
        if (pausedAttemptId) {
          void telemetryTracker.onSessionFinalized({
            attemptId: pausedAttemptId,
            outcome: 'abandoned_stale',
            sessionType: sessionTypeRef.current,
            plannedDurationSeconds: totalSecondsRef.current,
            remainingSecondsAtEnd: remainingSecondsRef.current,
            cycleIndex: currentCycleRef.current,
            tagId: activeTagIdRef.current,
            settings: settingsRef.current,
            dailyGoalMinutes: profileRef.current.dailyGoalMinutes,
            coffeeCups: coffeeCupsRef.current,
            wasStarted: true,
          });
        } else {
          void telemetryTracker.finalizeOrphanedDraftIfStale();
        }
      }

      const defaultDuration = getDurationForType('WORK');
      const nowMs = getServerAlignedNowMs();
      const prevUpdatedAtMs = Math.max(
        localUpdatedAtRef.current,
        latestRemote?.updatedAtMs ?? 0
      );

      sessionTypeRef.current = 'WORK';
      statusRef.current = 'IDLE';
      currentCycleRef.current = 1;
      totalSecondsRef.current = defaultDuration;
      remainingSecondsRef.current = defaultDuration;
      targetEndTimeRef.current = null;
      timerRunIdRef.current = null;
      localUpdatedAtRef.current = nowMs;

      setSessionType('WORK');
      setStatus('IDLE');
      setCurrentCycle(1);
      setTotalSeconds(defaultDuration);
      setRemainingSeconds(defaultDuration);
      setTargetEndTime(null);

      wakeLockService.release();

      setLastResetDayKey(currentDayKey);

      const resetState: SavedTimerState = {
        sessionType: 'WORK',
        status: 'IDLE',
        currentCycle: 1,
        remainingSeconds: defaultDuration,
        totalSeconds: defaultDuration,
        targetEndTime: null,
        timerRunId: null,
        updatedAtMs: nowMs,
        activeTagId: activeTagIdRef.current,
        deviceId: DEVICE_ID,
        tabId: TAB_ID,
        lastActiveAtMs: Date.now(),
        wasHidden: typeof document !== 'undefined' ? document.visibilityState === 'hidden' : false,
      };
      saveTimerState(resetState);

      publishLocalTimerState(
        {
          sessionType: 'WORK',
          status: 'IDLE',
          remainingSeconds: defaultDuration,
          totalSeconds: defaultDuration,
          targetEndTime: null,
          currentCycle: 1,
          activeTagId: activeTagIdRef.current,
          timerRunId: null,
          updatedAtMs: nowMs,
        },
        false,
        {
          onlyIfNotRunning: true,
          expectedUpdatedAtMs: prevUpdatedAtMs,
        }
      );

      return true;
    }

    return false;
  }, [
    sessions,
    convexSessions,
    isConvexConfigured,
    hasResolvedRemoteTimer,
    isAuthenticatedRef,
    hasResolvedRemoteTimerRef,
    remoteTimerRef,
    statusRef,
    sessionTypeRef,
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
    publishLocalTimerState,
  ]);

  useEffect(() => {
    checkAndResetForNewDay();

    let wakeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    const handleWakeOrFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'hidden') {
        if (wakeDebounceTimer) {
          clearTimeout(wakeDebounceTimer);
        }
        wakeDebounceTimer = setTimeout(() => {
          wakeDebounceTimer = null;
          checkAndResetForNewDay();
        }, 1500);
      }
    };

    if (typeof window !== 'undefined') {
      document.addEventListener('visibilitychange', handleWakeOrFocus);
      window.addEventListener('pageshow', handleWakeOrFocus);
      window.addEventListener('focus', handleWakeOrFocus);
    }

    const intervalId = setInterval(() => {
      checkAndResetForNewDay();
    }, 60000);

    return () => {
      if (wakeDebounceTimer) {
        clearTimeout(wakeDebounceTimer);
      }
      if (typeof window !== 'undefined') {
        document.removeEventListener('visibilitychange', handleWakeOrFocus);
        window.removeEventListener('pageshow', handleWakeOrFocus);
        window.removeEventListener('focus', handleWakeOrFocus);
      }
      clearInterval(intervalId);
    };
  }, [checkAndResetForNewDay]);
}

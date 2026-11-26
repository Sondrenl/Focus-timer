import React, { useCallback, useEffect } from 'react';
import { SessionType, RemoteTimerState } from '../../types/timer';
import { CompletedSession } from '../../types/session';
import { wakeLockService } from '../../services/screen/WakeLockService';
import {
  shouldResetForNewDay,
  getLogicalDayKey,
  getLastResetDayKey,
  setLastResetDayKey,
  getLastSessionCompletedAt,
  resolveEffectiveResetDayKey,
  INACTIVITY_THRESHOLD_MS,
} from '../../utils/newDayCheck';
import { DEVICE_ID, saveTimerState } from './timerPersistence';
import { ResetTimerOptions, TimerSharedRefs, TimerSnapshot } from './useTimerCloudSync';
import { telemetryTracker } from '../services';

interface UseTimerNewDayResetParams {
  sessions: CompletedSession[];
  convexSessions: unknown;
  isConvexConfigured: boolean;
  isAuthLoading?: boolean;
  hasResolvedRemoteTimer: boolean;
  hasResolvedRemoteTimerRef: React.MutableRefObject<boolean>;
  remoteTimerRef: React.MutableRefObject<any>;
  refs: TimerSharedRefs;
  getServerAlignedNowMs: () => number;
  commitTimerSnapshot: (snapshot: TimerSnapshot) => void;
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
  isAuthLoading = false,
  hasResolvedRemoteTimer,
  hasResolvedRemoteTimerRef,
  remoteTimerRef,
  refs,
  getServerAlignedNowMs,
  commitTimerSnapshot,
  getDurationForType,
  publishLocalTimerState,
}: UseTimerNewDayResetParams) {
  const checkAndResetForNewDay = useCallback(() => {
    if (refs.statusRef.current === 'RUNNING') return false;

    if (isConvexConfigured && isAuthLoading) {
      return false;
    }

    if (
      isConvexConfigured &&
      refs.isAuthenticatedRef.current &&
      (!hasResolvedRemoteTimer || !hasResolvedRemoteTimerRef.current || convexSessions === undefined)
    ) {
      return false;
    }

    const latestRemote = remoteTimerRef.current;
    if (latestRemote?.status === 'RUNNING') return false;

    const now = new Date();
    const nowAlignedMs = getServerAlignedNowMs();
    const currentDayKey = getLogicalDayKey(now);
    const localResetDayKey = getLastResetDayKey();
    const effectiveLastResetDayKey = resolveEffectiveResetDayKey(
      localResetDayKey,
      latestRemote?.lastResetDayKey
    );

    if (latestRemote?.lastResetDayKey === currentDayKey && localResetDayKey !== currentDayKey) {
      setLastResetDayKey(currentDayKey);
    }

    if (latestRemote && getLogicalDayKey(latestRemote.updatedAtMs) === currentDayKey) {
      if (
        latestRemote.status === 'IDLE' &&
        latestRemote.sessionType === 'WORK' &&
        latestRemote.currentCycle === 1
      ) {
        if (localResetDayKey !== currentDayKey) setLastResetDayKey(currentDayKey);
        return false;
      }
      if (nowAlignedMs - latestRemote.updatedAtMs < INACTIVITY_THRESHOLD_MS) return false;
    }

    if (refs.statusRef.current === 'PAUSED' || latestRemote?.status === 'PAUSED') {
      const pausedAtMs = Math.max(refs.localUpdatedAtRef.current, latestRemote?.updatedAtMs ?? 0);
      if (pausedAtMs > 0 && nowAlignedMs - pausedAtMs < INACTIVITY_THRESHOLD_MS) return false;
    }

    if (
      !shouldResetForNewDay({
        now,
        lastSessionTimeMs: getLastSessionCompletedAt(sessions),
        lastResetDayKey: effectiveLastResetDayKey,
        isTimerRunning: false,
      })
    ) {
      return false;
    }

    if (refs.statusRef.current === 'PAUSED' || latestRemote?.status === 'PAUSED') {
      const pausedAttemptId = refs.timerRunIdRef.current || latestRemote?.timerRunId || null;
      if (pausedAttemptId) {
        void telemetryTracker.onSessionFinalized({
          attemptId: pausedAttemptId,
          outcome: 'abandoned_stale',
          sessionType: refs.sessionTypeRef.current,
          plannedDurationSeconds: refs.totalSecondsRef.current,
          remainingSecondsAtEnd: refs.remainingSecondsRef.current,
          cycleIndex: refs.currentCycleRef.current,
          tagId: refs.activeTagIdRef.current,
          settings: refs.settingsRef.current,
          dailyGoalMinutes: refs.profileRef.current.dailyGoalMinutes,
          wasStarted: true,
        });
      }
    }

    const defaultDuration = getDurationForType('WORK');
    const nowMs = getServerAlignedNowMs();
    const prevUpdatedAtMs =
      typeof latestRemote?.updatedAtMs === 'number'
        ? latestRemote.updatedAtMs
        : refs.localUpdatedAtRef.current;

    refs.localUpdatedAtRef.current = nowMs;
    commitTimerSnapshot({
      sessionType: 'WORK',
      status: 'IDLE',
      currentCycle: 1,
      totalSeconds: defaultDuration,
      remainingSeconds: defaultDuration,
      targetEndTime: null,
      timerRunId: null,
    });

    wakeLockService.release();
    setLastResetDayKey(currentDayKey);

    if (!isConvexConfigured || !refs.isAuthenticatedRef.current) {
      saveTimerState({
        sessionType: 'WORK',
        status: 'IDLE',
        currentCycle: 1,
        remainingSeconds: defaultDuration,
        totalSeconds: defaultDuration,
        targetEndTime: null,
        timerRunId: null,
        updatedAtMs: nowMs,
        activeTagId: refs.activeTagIdRef.current,
        deviceId: DEVICE_ID,
        lastActiveAtMs: Date.now(),
        wasHidden: typeof document !== 'undefined' ? document.visibilityState === 'hidden' : false,
      });
    }

    publishLocalTimerState(
      {
        sessionType: 'WORK',
        status: 'IDLE',
        remainingSeconds: defaultDuration,
        totalSeconds: defaultDuration,
        targetEndTime: null,
        currentCycle: 1,
        activeTagId: refs.activeTagIdRef.current,
        timerRunId: null,
        lastResetDayKey: currentDayKey,
        updatedAtMs: nowMs,
      },
      false,
      {
        onlyIfNotRunning: true,
        expectedUpdatedAtMs: prevUpdatedAtMs,
        lastResetDayKey: currentDayKey,
      }
    );

    return true;
  }, [
    sessions,
    convexSessions,
    isConvexConfigured,
    isAuthLoading,
    hasResolvedRemoteTimer,
    hasResolvedRemoteTimerRef,
    remoteTimerRef,
    refs,
    getServerAlignedNowMs,
    commitTimerSnapshot,
    getDurationForType,
    publishLocalTimerState,
  ]);

  useEffect(() => {
    checkAndResetForNewDay();

    let wakeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    const handleWakeOrFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'hidden') {
        if (wakeDebounceTimer) clearTimeout(wakeDebounceTimer);
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

    const intervalId = setInterval(checkAndResetForNewDay, 60000);

    return () => {
      if (wakeDebounceTimer) clearTimeout(wakeDebounceTimer);
      if (typeof window !== 'undefined') {
        document.removeEventListener('visibilitychange', handleWakeOrFocus);
        window.removeEventListener('pageshow', handleWakeOrFocus);
        window.removeEventListener('focus', handleWakeOrFocus);
      }
      clearInterval(intervalId);
    };
  }, [checkAndResetForNewDay]);
}

import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { SessionType, TimerStatus } from '../types/timer';
import { UserSettings, DEFAULT_SETTINGS } from '../types/settings';
import { DEFAULT_TAGS } from '../types/tag';
import { useAuthProfile } from './AuthProfileContext';
import { useData } from './DataContext';
import { subscribeTimerState, subscribeReset, TAB_ID } from '../services/timer/TimerBroadcast';
import { wakeLockService } from '../services/screen/WakeLockService';
import { getDurationForType as getBaseDurationForType } from '../utils/timerTransitions';
import {
  DEVICE_ID,
  SavedTimerState,
  loadInitialTimerState,
  saveTimerState,
} from './timer/timerPersistence';
import { useTimerAlerts } from './timer/useTimerAlerts';
import { useTimerCloudSync } from './timer/useTimerCloudSync';
import { useTimerWorker } from './timer/useTimerWorker';
import { useTimerNewDayReset } from './timer/useTimerNewDayReset';
import { useTimerActions } from './timer/useTimerActions';
import { telemetryTracker } from './services';

export interface TimerContextValue {
  sessionType: SessionType;
  status: TimerStatus;
  remainingSeconds: number;
  totalSeconds: number;
  targetEndTime: number | null;
  currentCycle: number;
  maxCycles: number;
  toggleStartPause: () => void;
  resetTimer: () => void;
  skipInterval: () => void;
  previousInterval: () => void;
}

const TimerContext = createContext<TimerContextValue | null>(null);

export const TimerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    settings,
    profile,
    sound,
    notifications,
    isEffectiveAuthenticated,
    isConvexAuthAuthenticated,
    isConvexAuthLoading,
    convexSync,
  } = useAuthProfile();

  const {
    coffeeCups,
    activeTagId,
    setActiveTagId,
    consumeSkipTagTelemetry,
    recordSession,
    sessions,
  } = useData();

  const getDurationForType = useCallback(
    (type: SessionType): number => {
      return getBaseDurationForType(type, settings);
    },
    [settings]
  );

  const [initialState] = useState<SavedTimerState>(() =>
    loadInitialTimerState(settings.workDurationMinutes)
  );

  const [sessionType, setSessionType] = useState<SessionType>(initialState.sessionType);
  const [status, setStatus] = useState<TimerStatus>(initialState.status);
  const [currentCycle, setCurrentCycle] = useState<number>(initialState.currentCycle);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(initialState.remainingSeconds);
  const [totalSeconds, setTotalSeconds] = useState<number>(initialState.totalSeconds);
  const [targetEndTime, setTargetEndTime] = useState<number | null>(initialState.targetEndTime);

  const targetEndTimeRef = useRef<number | null>(initialState.targetEndTime);
  targetEndTimeRef.current = targetEndTime;

  const localUpdatedAtRef = useRef<number>(
    typeof initialState.updatedAtMs === 'number' ? initialState.updatedAtMs : 0
  );
  const lastLocalActionWallMsRef = useRef<number>(0);
  const timerRunIdRef = useRef<string | null>(initialState.timerRunId || null);
  const prevActiveTagIdRef = useRef<string | null>(activeTagId);
  const lastTickWallMsRef = useRef<number>(Date.now());

  const sessionTypeRef = useRef<SessionType>(sessionType);
  sessionTypeRef.current = sessionType;

  const statusRef = useRef<TimerStatus>(status);
  statusRef.current = status;

  const currentCycleRef = useRef<number>(currentCycle);
  currentCycleRef.current = currentCycle;

  const totalSecondsRef = useRef<number>(totalSeconds);
  totalSecondsRef.current = totalSeconds;

  const remainingSecondsRef = useRef<number>(remainingSeconds);
  remainingSecondsRef.current = remainingSeconds;

  const settingsRef = useRef<UserSettings>(settings);
  settingsRef.current = settings;

  const profileRef = useRef(profile);
  profileRef.current = profile;

  const coffeeCupsRef = useRef(coffeeCups);
  coffeeCupsRef.current = coffeeCups;

  const activeTagIdRef = useRef<string | null>(activeTagId);
  activeTagIdRef.current = activeTagId;

  const isAuthenticatedRef = useRef<boolean>(isEffectiveAuthenticated);
  isAuthenticatedRef.current = isEffectiveAuthenticated;

  const isConvexConnectedRef = useRef<boolean>(convexSync.isConvexConnected);
  isConvexConnectedRef.current = convexSync.isConvexConnected;

  const isDevicePushRegisteredRef = useRef<boolean | undefined>(
    convexSync.devicePushStatus?.registered
  );
  isDevicePushRegisteredRef.current = convexSync.devicePushStatus?.registered;

  const mountedAtMsRef = useRef<number>(Date.now());
  const wasExpiredAtMountRef = useRef<boolean>(
    initialState.status === 'RUNNING' &&
      initialState.targetEndTime !== null &&
      initialState.targetEndTime <= mountedAtMsRef.current
  );

  const handleCompleteRef = useRef<(silent?: boolean) => void>(() => {});

  const {
    dispatchCompletionAlert,
    triggerCompletionConfetti,
  } = useTimerAlerts({
    timerRunIdRef,
    settingsRef,
    sound,
    notifications,
    isEffectiveAuthenticatedRef: isAuthenticatedRef,
    isConvexConnectedRef,
    isDevicePushRegisteredRef,
  });

  const {
    publishLocalTimerState,
    publishTimerCompletion,
    applyRemoteState,
    isInitialMountDoneRef,
    hasResolvedRemoteTimerRef,
    remoteTimerRef,
    isConvexConfigured,
  } = useTimerCloudSync({
    isAuthenticated: isEffectiveAuthenticated,
    isConvexAuthAuthenticated,
    isConvexAuthLoading,
    isAuthenticatedRef,
    sessionTypeRef,
    statusRef,
    currentCycleRef,
    totalSecondsRef,
    remainingSecondsRef,
    targetEndTimeRef,
    timerRunIdRef,
    localUpdatedAtRef,
    lastLocalActionWallMsRef,
    lastTickWallMsRef,
    prevActiveTagIdRef,
    settingsRef,
    profileRef,
    coffeeCupsRef,
    handleCompleteRef,
    setSessionType,
    setStatus,
    setCurrentCycle,
    setTotalSeconds,
    setRemainingSeconds,
    setTargetEndTime,
    setActiveTagId,
    getDurationForType,
    dispatchCompletionAlert,
  });

  const {
    handleComplete,
    handleStaleExpiration,
    reset,
    skip,
    previousInterval,
    toggleStartPause,
  } = useTimerActions({
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
  });

  handleCompleteRef.current = handleComplete;

  useEffect(() => {
    if (status === 'IDLE') {
      const newDuration = getDurationForType(sessionType);
      const changed =
        totalSecondsRef.current !== newDuration ||
        remainingSecondsRef.current !== newDuration;
      if (changed) {
        totalSecondsRef.current = newDuration;
        remainingSecondsRef.current = newDuration;
        setTotalSeconds(newDuration);
        setRemainingSeconds(newDuration);

        const canPublishRemote =
          isInitialMountDoneRef.current &&
          (!isConvexConfigured || !isAuthenticatedRef.current || hasResolvedRemoteTimerRef.current) &&
          remoteTimerRef.current?.status !== 'RUNNING' &&
          remoteTimerRef.current?.status !== 'PAUSED';

        if (canPublishRemote) {
          const now = Date.now();
          publishLocalTimerState(
            {
              sessionType: sessionTypeRef.current,
              status: 'IDLE',
              remainingSeconds: newDuration,
              totalSeconds: newDuration,
              targetEndTime: null,
              currentCycle: currentCycleRef.current,
              activeTagId: activeTagIdRef.current,
              timerRunId: null,
              updatedAtMs: now,
            },
            false,
            { onlyIfNotRunning: true }
          );
        }
      }
    }
  }, [
    sessionType,
    settings.workDurationMinutes,
    settings.shortBreakDurationMinutes,
    settings.longBreakDurationMinutes,
    status,
    getDurationForType,
    publishLocalTimerState,
    isInitialMountDoneRef,
    hasResolvedRemoteTimerRef,
    remoteTimerRef,
    isConvexConfigured,
  ]);

  useEffect(() => {
    const shouldSkipTelemetry = consumeSkipTagTelemetry();
    if (prevActiveTagIdRef.current === activeTagId) return;
    const previousTagId = prevActiveTagIdRef.current;
    prevActiveTagIdRef.current = activeTagId;

    if (
      !isInitialMountDoneRef.current ||
      (isConvexConfigured && isAuthenticatedRef.current && !hasResolvedRemoteTimerRef.current)
    ) {
      return;
    }

    if (!shouldSkipTelemetry) {
      void telemetryTracker.onTagChanged({
        previousTagId,
        nextTagId: activeTagId,
        timerStatus: statusRef.current,
        sessionType: sessionTypeRef.current,
        attemptId: timerRunIdRef.current,
      });
    }

    const now = Date.now();
    const currentRemaining =
      statusRef.current === 'RUNNING' && targetEndTimeRef.current !== null
        ? Math.max(1, Math.ceil((targetEndTimeRef.current - now) / 1000))
        : remainingSecondsRef.current;

    publishLocalTimerState(
      {
        sessionType: sessionTypeRef.current,
        status: statusRef.current,
        remainingSeconds: currentRemaining,
        totalSeconds: totalSecondsRef.current,
        targetEndTime: targetEndTimeRef.current,
        currentCycle: currentCycleRef.current,
        activeTagId,
        timerRunId: timerRunIdRef.current,
        updatedAtMs: now,
      },
      false,
      statusRef.current === 'IDLE' ? { onlyIfNotRunning: true } : undefined
    );
  }, [
    activeTagId,
    consumeSkipTagTelemetry,
    publishLocalTimerState,
    isInitialMountDoneRef,
    hasResolvedRemoteTimerRef,
    isConvexConfigured,
  ]);

  const persistedRemainingSeconds = status === 'RUNNING' ? null : remainingSeconds;

  useEffect(() => {
    const stateToSave: SavedTimerState = {
      sessionType,
      status,
      currentCycle,
      remainingSeconds: remainingSecondsRef.current,
      totalSeconds,
      targetEndTime,
      timerRunId: timerRunIdRef.current,
      updatedAtMs: localUpdatedAtRef.current,
      activeTagId,
      deviceId: DEVICE_ID,
      tabId: TAB_ID,
      lastActiveAtMs: Date.now(),
      wasHidden: typeof document !== 'undefined' ? document.visibilityState === 'hidden' : false,
    };
    saveTimerState(stateToSave);
  }, [
    sessionType,
    status,
    currentCycle,
    persistedRemainingSeconds,
    totalSeconds,
    targetEndTime,
    activeTagId,
  ]);

  useEffect(() => {
    if (initialState.status === 'IDLE') {
      void telemetryTracker.finalizeOrphanedDraftIfStale();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep Web Audio unlocked for reloaded, remote-started, multi-tab, or auto-started running timers,
  // and mark AudioContext for zombie-hardware health checks when returning from background/sleep.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    let gestureArmed = false;
    const handleUnlockGesture = () => {
      gestureArmed = false;
      window.removeEventListener('pointerdown', handleUnlockGesture);
      window.removeEventListener('keydown', handleUnlockGesture);
      if (settingsRef.current.soundEnabled) {
        sound.prepareForPlayback();
      }
    };

    const armUnlockGesture = () => {
      if (gestureArmed || statusRef.current !== 'RUNNING' || !settingsRef.current.soundEnabled) {
        return;
      }
      gestureArmed = true;
      window.addEventListener('pointerdown', handleUnlockGesture, { passive: true });
      window.addEventListener('keydown', handleUnlockGesture, { passive: true });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        sound.markStaleForRecovery();
        armUnlockGesture();
      }
    };

    if (status === 'RUNNING' && settings.soundEnabled) {
      armUnlockGesture();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (gestureArmed) {
        window.removeEventListener('pointerdown', handleUnlockGesture);
        window.removeEventListener('keydown', handleUnlockGesture);
      }
    };
  }, [status, settings.soundEnabled, sound]);

  const shouldDeferExpiredCompletion = useCallback(() => {
    if (!wasExpiredAtMountRef.current) return false;
    if (!isConvexConfigured || !isAuthenticatedRef.current) {
      wasExpiredAtMountRef.current = false;
      return false;
    }
    if (hasResolvedRemoteTimerRef.current) {
      wasExpiredAtMountRef.current = false;
      return false;
    }
    if (Date.now() - mountedAtMsRef.current >= 1500) {
      wasExpiredAtMountRef.current = false;
      return false;
    }
    return true;
  }, [isConvexConfigured, hasResolvedRemoteTimerRef]);

  useTimerWorker({
    status,
    sessionType,
    remainingSeconds,
    keepAwake: settings.keepAwake !== false,
    statusRef,
    sessionTypeRef,
    currentCycleRef,
    remainingSecondsRef,
    totalSecondsRef,
    targetEndTimeRef,
    timerRunIdRef,
    localUpdatedAtRef,
    activeTagIdRef,
    lastTickWallMsRef,
    handleCompleteRef,
    shouldDeferExpiredCompletion,
    onStaleExpiration: handleStaleExpiration,
    setRemainingSeconds,
  });

  useEffect(() => {
    const unsubscribeState = subscribeTimerState((incoming) => {
      const now = Date.now();
      const hasRecentLocalAction = now - lastLocalActionWallMsRef.current < 1500;
      if (!hasRecentLocalAction || incoming.updatedAtMs > localUpdatedAtRef.current) {
        applyRemoteState(incoming);
      }
    });

    const unsubscribeReset = subscribeReset((scope, { isRemoteTab }) => {
      const defaultDuration =
        scope === 'factory-reset'
          ? Math.max(1, Math.round(DEFAULT_SETTINGS.workDurationMinutes * 60))
          : getDurationForType('WORK');
      const nowMs = Date.now();
      const resetTagId =
        scope === 'factory-reset' ? (DEFAULT_TAGS[0]?.id ?? null) : activeTagIdRef.current;

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

      telemetryTracker.invalidateDraftCache();

      if (scope === 'factory-reset') {
        prevActiveTagIdRef.current = resetTagId;
      }

      if (!isRemoteTab) {
        publishLocalTimerState(
          {
            sessionType: 'WORK',
            status: 'IDLE',
            remainingSeconds: defaultDuration,
            totalSeconds: defaultDuration,
            targetEndTime: null,
            currentCycle: 1,
            activeTagId: resetTagId,
            timerRunId: null,
            updatedAtMs: nowMs,
          },
          true
        );
      }
    });

    return () => {
      unsubscribeState();
      unsubscribeReset();
    };
  }, [getDurationForType, applyRemoteState, publishLocalTimerState]);

  useTimerNewDayReset({
    sessions,
    convexSessions: convexSync.convexSessions,
    isConvexConfigured,
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
    setSessionType,
    setStatus,
    setCurrentCycle,
    setTotalSeconds,
    setRemainingSeconds,
    setTargetEndTime,
    getDurationForType,
    publishLocalTimerState,
  });

  const value = useMemo<TimerContextValue>(
    () => ({
      sessionType,
      status,
      remainingSeconds,
      totalSeconds,
      targetEndTime,
      currentCycle,
      maxCycles: settings.longBreakInterval,
      toggleStartPause,
      resetTimer: reset,
      skipInterval: skip,
      previousInterval,
    }),
    [
      sessionType,
      status,
      remainingSeconds,
      totalSeconds,
      targetEndTime,
      currentCycle,
      settings.longBreakInterval,
      toggleStartPause,
      reset,
      skip,
      previousInterval,
    ]
  );

  return <TimerContext.Provider value={value}>{children}</TimerContext.Provider>;
};

export const useTimer = (): TimerContextValue => {
  const context = useContext(TimerContext);
  if (!context) {
    throw new Error('useTimer must be used within a TimerProvider');
  }
  return context;
};

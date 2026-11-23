import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import { SessionType, TimerStatus } from '../types/timer';
import { UserSettings } from '../types/settings';
import { useAuthProfile } from './AuthProfileContext';
import { useData } from './DataContext';
import { getDurationForType as getBaseDurationForType } from '../utils/timerTransitions';
import {
  DEVICE_ID,
  SavedTimerState,
  loadInitialTimerState,
  saveTimerState,
} from './timer/timerPersistence';
import { useTimerAlerts } from './timer/useTimerAlerts';
import {
  TimerSharedRefs,
  TimerSnapshot,
  useTimerCloudSync,
} from './timer/useTimerCloudSync';
import { useTimerWorker } from './timer/useTimerWorker';
import { useTimerNewDayReset } from './timer/useTimerNewDayReset';
import { useTimerActions } from './timer/useTimerActions';

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
    isConvexAuthReady,
    convexSync,
  } = useAuthProfile();

  const { activeTagId, setActiveTagId, recordSession, sessions } = useData();

  const getDurationForType = useCallback(
    (type: SessionType): number => getBaseDurationForType(type, settings),
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

  const serverClockOffsetMsRef = useRef<number>(0);
  const handleCompleteRef = useRef<(silent?: boolean) => void>(() => {});

  const refs = useMemo<TimerSharedRefs>(
    () => ({
      isAuthenticatedRef,
      isConvexConnectedRef,
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
      activeTagIdRef,
      prevActiveTagIdRef,
      serverClockOffsetMsRef,
      settingsRef,
      profileRef,
      handleCompleteRef,
    }),
    []
  );

  const getServerAlignedNowMs = useCallback(
    () => Date.now() + serverClockOffsetMsRef.current,
    []
  );

  const commitTimerSnapshot = useCallback(
    (snapshot: TimerSnapshot) => {
      if (snapshot.sessionType !== undefined) {
        sessionTypeRef.current = snapshot.sessionType;
        setSessionType(snapshot.sessionType);
      }
      if (snapshot.currentCycle !== undefined) {
        currentCycleRef.current = snapshot.currentCycle;
        setCurrentCycle(snapshot.currentCycle);
      }
      if (snapshot.totalSeconds !== undefined) {
        totalSecondsRef.current = snapshot.totalSeconds;
        setTotalSeconds(snapshot.totalSeconds);
      }
      statusRef.current = snapshot.status;
      remainingSecondsRef.current = snapshot.remainingSeconds;
      targetEndTimeRef.current = snapshot.targetEndTime;
      timerRunIdRef.current = snapshot.timerRunId;
      if (snapshot.activeTagId !== undefined) {
        activeTagIdRef.current = snapshot.activeTagId;
        prevActiveTagIdRef.current = snapshot.activeTagId;
        setActiveTagId(snapshot.activeTagId);
      }
      setStatus(snapshot.status);
      setRemainingSeconds(snapshot.remainingSeconds);
      setTargetEndTime(snapshot.targetEndTime);
    },
    [setActiveTagId]
  );

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
    isOnlineAndConnected,
    publishLocalTimerState,
    publishTagUpdate,
    isInitialMountDoneRef,
    hasResolvedRemoteTimer,
    hasResolvedRemoteTimerRef,
    remoteTimerRef,
    isConvexConfigured,
  } = useTimerCloudSync({
    isAuthenticated: isEffectiveAuthenticated,
    isConvexAuthReady,
    isConvexConnected: convexSync.isConvexConnected,
    refs,
    getServerAlignedNowMs,
    commitTimerSnapshot,
    getDurationForType,
    dispatchCompletionAlert,
    triggerCompletionConfetti,
  });

  const {
    handleComplete,
    handleStaleExpiration,
    reset,
    skip,
    previousInterval,
    toggleStartPause,
  } = useTimerActions({
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
  });

  handleCompleteRef.current = handleComplete;

  // Update IDLE duration when settings change
  useEffect(() => {
    if (status !== 'IDLE') return;
    const newDuration = getDurationForType(sessionType);
    if (totalSecondsRef.current === newDuration && remainingSecondsRef.current === newDuration) {
      return;
    }
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
          updatedAtMs: getServerAlignedNowMs(),
        },
        false,
        { onlyIfIdle: true }
      );
    }
  }, [
    sessionType,
    settings.workDurationMinutes,
    settings.shortBreakDurationMinutes,
    settings.longBreakDurationMinutes,
    status,
    getDurationForType,
    getServerAlignedNowMs,
    publishLocalTimerState,
    isInitialMountDoneRef,
    hasResolvedRemoteTimerRef,
    remoteTimerRef,
    isConvexConfigured,
  ]);

  // Publish activeTagId changes after initial hydration
  useEffect(() => {
    if (prevActiveTagIdRef.current === activeTagId) return;
    prevActiveTagIdRef.current = activeTagId;
    if (
      !isInitialMountDoneRef.current ||
      (isConvexConfigured && isAuthenticatedRef.current && !hasResolvedRemoteTimerRef.current)
    ) {
      return;
    }
    publishTagUpdate(activeTagId);
  }, [
    activeTagId,
    publishTagUpdate,
    isInitialMountDoneRef,
    hasResolvedRemoteTimerRef,
    isConvexConfigured,
  ]);

  // Persist timer state to localStorage strictly in guest mode (Convex is source of truth when signed in)
  const persistedRemainingSeconds = status === 'RUNNING' ? null : remainingSeconds;
  useEffect(() => {
    if (isConvexConfigured && isEffectiveAuthenticated) return;
    saveTimerState({
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
      lastActiveAtMs: Date.now(),
      wasHidden: typeof document !== 'undefined' ? document.visibilityState === 'hidden' : false,
    });
  }, [
    isConvexConfigured,
    isEffectiveAuthenticated,
    sessionType,
    status,
    currentCycle,
    persistedRemainingSeconds,
    totalSeconds,
    targetEndTime,
    activeTagId,
  ]);

  // Re-arm audio context on visibility return while running
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    let gestureArmed = false;
    const handleUnlockGesture = () => {
      gestureArmed = false;
      window.removeEventListener('pointerdown', handleUnlockGesture);
      window.removeEventListener('keydown', handleUnlockGesture);
      if (settingsRef.current.soundEnabled) sound.prepareForPlayback();
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

    if (status === 'RUNNING' && settings.soundEnabled) armUnlockGesture();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (gestureArmed) {
        window.removeEventListener('pointerdown', handleUnlockGesture);
        window.removeEventListener('keydown', handleUnlockGesture);
      }
    };
  }, [status, settings.soundEnabled, sound]);

  // When signed in and connected to Convex, defer completion to server-scheduled onTimerCompleted
  const shouldDeferExpiredCompletion = useCallback(
    () => isOnlineAndConnected(),
    [isOnlineAndConnected]
  );

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
    getServerAlignedNowMs,
    handleCompleteRef,
    shouldDeferExpiredCompletion,
    onStaleExpiration: handleStaleExpiration,
    setRemainingSeconds,
  });

  useTimerNewDayReset({
    sessions,
    convexSessions: convexSync.convexSessions,
    isConvexConfigured,
    hasResolvedRemoteTimer,
    hasResolvedRemoteTimerRef,
    remoteTimerRef,
    refs,
    getServerAlignedNowMs,
    commitTimerSnapshot,
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

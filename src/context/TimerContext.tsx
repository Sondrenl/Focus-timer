import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { SessionType, TimerStatus, TimerState, PeerPresence } from '../types/timer';
import { UserSettings, DEFAULT_SETTINGS } from '../types/settings';
import { useApp } from './AppContext';
import { AuthService } from '../services/auth/AuthService';
import { subscribeTimerState, subscribeReset, TAB_ID } from '../services/timer/TimerBroadcast';
import { wakeLockService } from '../services/screen/WakeLockService';
import {
  computeNextInterval,
  getDurationForType as getBaseDurationForType,
} from '../utils/timerTransitions';
import {
  DEVICE_ID,
  DEVICE_SESSION_ID,
  SavedTimerState,
  loadInitialTimerState,
  saveTimerState,
} from './timer/timerPersistence';
import { useTimerAlerts } from './timer/useTimerAlerts';
import { useTimerCloudSync } from './timer/useTimerCloudSync';
import { useTimerWorker } from './timer/useTimerWorker';

export { DEVICE_SESSION_ID };

export interface TimerContextValue {
  state: TimerState;
  sessionType: SessionType;
  status: TimerStatus;
  remainingSeconds: number;
  totalSeconds: number;
  targetEndTime: number | null;
  currentCycle: number;
  maxCycles: number;
  activeTagId: string | null;
  start: () => void;
  pause: () => void;
  reset: () => void;
  skip: () => void;
  switchSessionType: (type: SessionType) => void;
  toggleStartPause: () => void;
  resetTimer: () => void;
  skipInterval: () => void;
  setSessionTypeManually: (type: SessionType) => void;
  peerPresence: PeerPresence;
}

const TimerContext = createContext<TimerContextValue | null>(null);

export const TimerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    settings,
    activeTagId,
    setActiveTagId,
    recordSession,
    sound,
    notifications,
    isEffectiveAuthenticated,
  } = useApp();

  const authService = AuthService.getInstance();

  // Retrieve initial duration configured in user preferences
  const getDurationForType = useCallback(
    (type: SessionType): number => {
      return getBaseDurationForType(type, settings);
    },
    [settings]
  );

  // Initialize timer state from storage or default to configured work duration
  const [initialState] = useState<SavedTimerState>(() =>
    loadInitialTimerState(settings.workDurationMinutes)
  );

  const [sessionType, setSessionType] = useState<SessionType>(initialState.sessionType);
  const [status, setStatus] = useState<TimerStatus>(initialState.status);
  const [currentCycle, setCurrentCycle] = useState<number>(initialState.currentCycle);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(initialState.remainingSeconds);
  const [totalSeconds, setTotalSeconds] = useState<number>(initialState.totalSeconds);
  const [targetEndTime, setTargetEndTime] = useState<number | null>(initialState.targetEndTime);

  // Synchronization refs for high-frequency ticks and remote cloud alignment
  const targetEndTimeRef = useRef<number | null>(initialState.targetEndTime);
  targetEndTimeRef.current = targetEndTime;

  const localUpdatedAtRef = useRef<number>(initialState.updatedAtMs || Date.now());
  const lastLocalActionWallMsRef = useRef<number>(0);
  const timerRunIdRef = useRef<string | null>(initialState.timerRunId || null);
  const prevActiveTagIdRef = useRef<string | null>(activeTagId);
  const lastTickWallMsRef = useRef<number>(Date.now());

  const peerPresenceRef = useRef<PeerPresence>({
    desktopActive: false,
    desktopVisible: false,
    mobileActive: false,
    mobileVisible: false,
  });

  // Fresh mutable refs for state to eliminate stale closures across callbacks
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

  const activeTagIdRef = useRef<string | null>(activeTagId);
  activeTagIdRef.current = activeTagId;

  const isAuthenticatedRef = useRef<boolean>(isEffectiveAuthenticated);
  isAuthenticatedRef.current = isEffectiveAuthenticated;

  const handleCompleteRef = useRef<(silent?: boolean) => void>(() => {});

  const {
    syncScheduledNotification,
    dispatchCompletionAlert,
    triggerCompletionConfetti,
  } = useTimerAlerts({
    statusRef,
    sessionTypeRef,
    targetEndTimeRef,
    timerRunIdRef,
    settingsRef,
    peerPresenceRef,
    sound,
    notifications,
  });

  const {
    publishLocalTimerState,
    reportPresence,
    applyRemoteState,
    isInitialMountDoneRef,
  } = useTimerCloudSync({
    isAuthenticated: isEffectiveAuthenticated,
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
    peerPresenceRef,
    settingsRef,
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
    sound,
    notifications,
    authService,
  });

  // Handle duration settings changes when timer is IDLE
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

        if (isInitialMountDoneRef.current) {
          const now = Date.now();
          publishLocalTimerState({
            sessionType: sessionTypeRef.current,
            status: 'IDLE',
            remainingSeconds: newDuration,
            totalSeconds: newDuration,
            targetEndTime: null,
            currentCycle: currentCycleRef.current,
            activeTagId: activeTagIdRef.current,
            timerRunId: null,
            updatedAtMs: now,
          });
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
  ]);

  // Handle activeTagId changes: sync tag selection across tabs and cloud
  useEffect(() => {
    if (prevActiveTagIdRef.current === activeTagId) return;
    prevActiveTagIdRef.current = activeTagId;

    // Ignore initial tag hydration on mount so a newly opened tab doesn't overwrite a running remote timer
    if (!isInitialMountDoneRef.current && statusRef.current === 'IDLE') {
      return;
    }

    const now = authService.getServerNow();
    const currentRemaining =
      statusRef.current === 'RUNNING' && targetEndTimeRef.current !== null
        ? Math.max(1, Math.ceil((targetEndTimeRef.current - now) / 1000))
        : remainingSecondsRef.current;

    publishLocalTimerState({
      sessionType: sessionTypeRef.current,
      status: statusRef.current,
      remainingSeconds: currentRemaining,
      totalSeconds: totalSecondsRef.current,
      targetEndTime: targetEndTimeRef.current,
      currentCycle: currentCycleRef.current,
      activeTagId,
      timerRunId: timerRunIdRef.current,
      updatedAtMs: Date.now(),
    });
  }, [activeTagId, authService, publishLocalTimerState, isInitialMountDoneRef]);

  // Persist state to localStorage on updates
  useEffect(() => {
    const stateToSave: SavedTimerState = {
      sessionType,
      status,
      currentCycle,
      remainingSeconds,
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
    saveTimerState(stateToSave, true);
  }, [sessionType, status, currentCycle, remainingSeconds, totalSeconds, targetEndTime, activeTagId]);

  // Completion handler callback
  const handleComplete = useCallback(
    (silent = false) => {
      const completedType = sessionTypeRef.current;
      const currentRunId = timerRunIdRef.current;
      const currentRemaining = remainingSecondsRef.current;
      const currentTotal = totalSecondsRef.current;

      const elapsedSeconds = Math.max(1, currentTotal - Math.max(0, currentRemaining));

      sound.stopSilentKeepAlive(true);
      wakeLockService.release();
      notifications.cancelScheduledNotification();

      if (!silent) {
        dispatchCompletionAlert(completedType, currentRunId);
        triggerCompletionConfetti();
      }

      void recordSession({
        tagId: activeTagIdRef.current,
        sessionType: completedType,
        durationSeconds: elapsedSeconds,
        completedAt: new Date().toISOString(),
      });

      const next = computeNextInterval(completedType, currentCycleRef.current, settingsRef.current);
      const nextType = next.nextType;
      const nextCycle = next.nextCycle;
      const nextDuration = next.nextDuration;
      const shouldAutoStart = next.shouldAutoStart;

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
        timerRunIdRef.current = newRunId;
        statusRef.current = 'RUNNING';
        remainingSecondsRef.current = nextDuration;
        setStatus('RUNNING');
        setRemainingSeconds(nextDuration);

        publishLocalTimerState({
          sessionType: nextType,
          status: 'RUNNING',
          remainingSeconds: nextDuration,
          totalSeconds: nextDuration,
          targetEndTime: now + nextDuration * 1000,
          currentCycle: nextCycle,
          activeTagId: activeTagIdRef.current,
          timerRunId: newRunId,
          updatedAtMs: now,
        });

        syncScheduledNotification();
      } else {
        timerRunIdRef.current = null;
        statusRef.current = 'IDLE';
        remainingSecondsRef.current = nextDuration;
        setStatus('IDLE');
        setRemainingSeconds(nextDuration);

        publishLocalTimerState({
          sessionType: nextType,
          status: 'IDLE',
          remainingSeconds: nextDuration,
          totalSeconds: nextDuration,
          targetEndTime: null,
          currentCycle: nextCycle,
          activeTagId: activeTagIdRef.current,
          timerRunId: null,
          updatedAtMs: now,
        });
      }
    },
    [
      recordSession,
      sound,
      notifications,
      publishLocalTimerState,
      syncScheduledNotification,
      dispatchCompletionAlert,
      triggerCompletionConfetti,
    ]
  );

  handleCompleteRef.current = handleComplete;

  useTimerWorker({
    status,
    sessionType,
    remainingSeconds,
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
    setRemainingSeconds,
    sound,
    syncScheduledNotification,
    reportPresence,
    authService,
  });

  // Multi-tab BroadcastChannel listener
  useEffect(() => {
    const unsubscribeState = subscribeTimerState((incoming) => {
      const now = Date.now();
      const hasRecentLocalAction = now - lastLocalActionWallMsRef.current < 1500;
      if (!hasRecentLocalAction || incoming.updatedAtMs > localUpdatedAtRef.current) {
        applyRemoteState(incoming);
      }
    });

    const unsubscribeReset = subscribeReset((scope) => {
      const defaultDuration =
        scope === 'factory-reset'
          ? Math.max(1, Math.round(DEFAULT_SETTINGS.workDurationMinutes * 60))
          : getDurationForType('WORK');
      const nowMs = Date.now();
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

      sound.stopSilentKeepAlive(false);
      wakeLockService.release();
      notifications.cancelScheduledNotification();

      if (scope === 'factory-reset') {
        prevActiveTagIdRef.current = null;
      }

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
        true
      );
    });

    return () => {
      unsubscribeState();
      unsubscribeReset();
    };
  }, [getDurationForType, sound, notifications, applyRemoteState, publishLocalTimerState]);

  // Action: Start timer
  const start = useCallback(() => {
    if (statusRef.current === 'RUNNING') return;

    sound.prepareForPlayback();
    wakeLockService.acquire();

    const duration = remainingSecondsRef.current;
    const now = Date.now();
    const calculatedTargetEnd = now + duration * 1000;
    const newRunId = `run-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    targetEndTimeRef.current = calculatedTargetEnd;
    timerRunIdRef.current = newRunId;
    statusRef.current = 'RUNNING';

    setTargetEndTime(calculatedTargetEnd);
    setStatus('RUNNING');

    publishLocalTimerState(
      {
        sessionType: sessionTypeRef.current,
        status: 'RUNNING',
        remainingSeconds: duration,
        totalSeconds: totalSecondsRef.current,
        targetEndTime: calculatedTargetEnd,
        currentCycle: currentCycleRef.current,
        activeTagId: activeTagIdRef.current,
        timerRunId: newRunId,
        updatedAtMs: now,
      },
      true
    );

    syncScheduledNotification();
  }, [sound, publishLocalTimerState, syncScheduledNotification]);

  // Action: Pause timer
  const pause = useCallback(() => {
    if (statusRef.current !== 'RUNNING') return;

    wakeLockService.release();
    notifications.cancelScheduledNotification();

    const now = authService.getServerNow();
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

    const nowMs = Date.now();
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
        updatedAtMs: nowMs,
      },
      true
    );
  }, [notifications, publishLocalTimerState, authService]);

  // Action: Reset timer
  const reset = useCallback(() => {
    wakeLockService.release();
    notifications.cancelScheduledNotification();
    sound.stopSilentKeepAlive(false);

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
  }, [getDurationForType, sound, notifications, publishLocalTimerState]);

  // Action: Skip interval
  const skip = useCallback(() => {
    wakeLockService.release();
    notifications.cancelScheduledNotification();
    sound.stopSilentKeepAlive(false);

    let nextType: SessionType;
    let nextCycle = currentCycleRef.current;

    if (sessionTypeRef.current === 'WORK') {
      if (currentCycleRef.current >= settingsRef.current.longBreakInterval) {
        nextType = 'LONG_BREAK';
        nextCycle = currentCycleRef.current;
      } else {
        nextType = 'SHORT_BREAK';
        nextCycle = currentCycleRef.current;
      }
    } else if (sessionTypeRef.current === 'SHORT_BREAK') {
      nextType = 'WORK';
      nextCycle = currentCycleRef.current + 1;
    } else {
      // LONG_BREAK skipped
      nextType = 'WORK';
      nextCycle = 1;
    }

    const nextDuration = getDurationForType(nextType);
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
  }, [getDurationForType, sound, notifications, publishLocalTimerState]);

  // Action: Explicitly switch session type
  const switchSessionType = useCallback(
    (type: SessionType) => {
      if (statusRef.current === 'RUNNING') {
        pause();
      }

      const duration = getDurationForType(type);
      sessionTypeRef.current = type;
      totalSecondsRef.current = duration;
      remainingSecondsRef.current = duration;
      statusRef.current = 'IDLE';
      targetEndTimeRef.current = null;
      timerRunIdRef.current = null;

      setSessionType(type);
      setTotalSeconds(duration);
      setRemainingSeconds(duration);
      setStatus('IDLE');
      setTargetEndTime(null);

      const nowMs = Date.now();
      publishLocalTimerState(
        {
          sessionType: type,
          status: 'IDLE',
          remainingSeconds: duration,
          totalSeconds: duration,
          targetEndTime: null,
          currentCycle: currentCycleRef.current,
          activeTagId: activeTagIdRef.current,
          timerRunId: null,
          updatedAtMs: nowMs,
        },
        true
      );
    },
    [getDurationForType, pause, publishLocalTimerState]
  );

  const toggleStartPause = useCallback(() => {
    if (statusRef.current === 'RUNNING') {
      pause();
    } else {
      start();
    }
  }, [pause, start]);

  const value: TimerContextValue = {
    state: {
      sessionType,
      status,
      remainingSeconds,
      totalSeconds,
      currentCycle,
      maxCycles: settings.longBreakInterval,
      activeTagId,
    },
    sessionType,
    status,
    remainingSeconds,
    totalSeconds,
    targetEndTime,
    currentCycle,
    maxCycles: settings.longBreakInterval,
    activeTagId,
    start,
    pause,
    reset,
    skip,
    switchSessionType,
    toggleStartPause,
    resetTimer: reset,
    skipInterval: skip,
    setSessionTypeManually: switchSessionType,
    peerPresence: peerPresenceRef.current,
  };

  return <TimerContext.Provider value={value}>{children}</TimerContext.Provider>;
};

export const useTimerContext = (): TimerContextValue => {
  const context = useContext(TimerContext);
  if (!context) {
    throw new Error('useTimerContext must be used within a TimerProvider');
  }
  return context;
};

export const useTimer = useTimerContext;

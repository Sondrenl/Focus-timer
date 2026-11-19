import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { SessionType, TimerStatus, PeerPresence } from '../types/timer';
import { UserSettings, DEFAULT_SETTINGS } from '../types/settings';
import { useApp } from './AppContext';
import { AuthService } from '../services/auth/AuthService';
import { subscribeTimerState, subscribeReset, TAB_ID } from '../services/timer/TimerBroadcast';
import { wakeLockService } from '../services/screen/WakeLockService';
import {
  computeNextInterval,
  computePreviousInterval,
  getDurationForType as getBaseDurationForType,
} from '../utils/timerTransitions';
import {
  DEVICE_ID,
  DEVICE_SESSION_ID,
  SavedTimerState,
  loadInitialTimerState,
  saveTimerState,
} from './timer/timerPersistence';
import {
  shouldResetForNewDay,
  getLogicalDayKey,
  getLastResetDayKey,
  setLastResetDayKey,
  getLastSessionCompletedAt,
} from '../utils/newDayCheck';
import { useTimerAlerts } from './timer/useTimerAlerts';
import { useTimerCloudSync } from './timer/useTimerCloudSync';
import { useTimerWorker } from './timer/useTimerWorker';
import { telemetryTracker } from './services';

export { DEVICE_SESSION_ID };

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
    coffeeCups,
    activeTagId,
    setActiveTagId,
    consumeSkipTagTelemetry,
    recordSession,
    sound,
    notifications,
    isEffectiveAuthenticated,
    isConvexAuthAuthenticated,
    isConvexAuthLoading,
    convexSync,
    sessions,
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

  const localUpdatedAtRef = useRef<number>(
    typeof initialState.updatedAtMs === 'number' ? initialState.updatedAtMs : 0
  );
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

  const profileRef = useRef(profile);
  profileRef.current = profile;

  const coffeeCupsRef = useRef(coffeeCups);
  coffeeCupsRef.current = coffeeCups;

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
    publishTimerCompletion,
    reportPresence,
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
    peerPresenceRef,
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

  // Handle activeTagId changes: sync tag selection across tabs and cloud
  useEffect(() => {
    const shouldSkipTelemetry = consumeSkipTagTelemetry();
    if (prevActiveTagIdRef.current === activeTagId) return;
    const previousTagId = prevActiveTagIdRef.current;
    prevActiveTagIdRef.current = activeTagId;

    // Ignore initial tag hydration on mount or before remote timer state resolves
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

    const now = authService.getServerNow();
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
        updatedAtMs: Date.now(),
      },
      false,
      statusRef.current === 'IDLE' ? { onlyIfNotRunning: true } : undefined
    );
  }, [
    activeTagId,
    consumeSkipTagTelemetry,
    authService,
    publishLocalTimerState,
    isInitialMountDoneRef,
    hasResolvedRemoteTimerRef,
    isConvexConfigured,
  ]);

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
      const currentCycleVal = currentCycleRef.current;
      const currentTargetEnd = targetEndTimeRef.current;

      const elapsedSeconds = Math.max(1, currentTotal - Math.max(0, currentRemaining));

      wakeLockService.release();
      notifications.cancelScheduledNotification();

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

      const next = computeNextInterval(completedType, currentCycleVal, settingsRef.current);
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

        syncScheduledNotification();
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
      recordSession,
      sound,
      notifications,
      publishTimerCompletion,
      syncScheduledNotification,
      dispatchCompletionAlert,
      triggerCompletionConfetti,
    ]
  );

  handleCompleteRef.current = handleComplete;

  const handleStaleExpiration = useCallback(() => {
    wakeLockService.release();
    notifications.cancelScheduledNotification();

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
    statusRef.current = 'IDLE';
    targetEndTimeRef.current = null;
    timerRunIdRef.current = null;
    totalSecondsRef.current = defaultDuration;
    remainingSecondsRef.current = defaultDuration;
    localUpdatedAtRef.current = 0;

    setStatus('IDLE');
    setTargetEndTime(null);
    setTotalSeconds(defaultDuration);
    setRemainingSeconds(defaultDuration);
  }, [getDurationForType, notifications]);

  useEffect(() => {
    if (initialState.status === 'IDLE') {
      void telemetryTracker.finalizeOrphanedDraftIfStale();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    onStaleExpiration: handleStaleExpiration,
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

      wakeLockService.release();
      notifications.cancelScheduledNotification();

      telemetryTracker.invalidateDraftCache();

      if (scope === 'factory-reset') {
        prevActiveTagIdRef.current = activeTagIdRef.current;
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

  // Action: Reset timer and session indicator dots for a new day if criteria are met
  const checkAndResetForNewDay = useCallback(() => {
    if (statusRef.current === 'RUNNING') return false;

    if (
      isConvexConfigured &&
      isAuthenticatedRef.current &&
      (!hasResolvedRemoteTimerRef.current || convexSync.convexSessions === undefined)
    ) {
      return false;
    }

    const latestRemote = remoteTimerRef.current;
    if (latestRemote && (latestRemote.status === 'RUNNING' || latestRemote.status === 'PAUSED')) {
      return false;
    }

    const now = new Date();
    const currentDayKey = getLogicalDayKey(now);
    if (latestRemote && getLogicalDayKey(latestRemote.updatedAtMs) === currentDayKey) {
      if (getLastResetDayKey() !== currentDayKey) {
        setLastResetDayKey(currentDayKey);
      }
      return false;
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
      if (statusRef.current === 'PAUSED') {
        if (timerRunIdRef.current) {
          void telemetryTracker.onSessionFinalized({
            attemptId: timerRunIdRef.current,
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
      const nowMs = Date.now();
      const prevUpdatedAtMs = localUpdatedAtRef.current;

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
      notifications.cancelScheduledNotification();

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
        lastActiveAtMs: nowMs,
        wasHidden: typeof document !== 'undefined' ? document.visibilityState === 'hidden' : false,
      };
      saveTimerState(resetState, true);

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
    convexSync.convexSessions,
    isConvexConfigured,
    hasResolvedRemoteTimerRef,
    remoteTimerRef,
    getDurationForType,
    notifications,
    publishLocalTimerState,
  ]);

  // Reactive listeners for waking tab / returning to tab / periodic new day rollover
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

  // Action: Start timer
  const start = useCallback(() => {
    if (statusRef.current === 'RUNNING') return;

    sound.prepareForPlayback();
    wakeLockService.acquire();

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
    void telemetryTracker.onSessionPaused({
      remainingSeconds: currentRemaining,
      tagId: activeTagIdRef.current,
      nowMs,
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
        updatedAtMs: nowMs,
      },
      true
    );
  }, [notifications, publishLocalTimerState, authService]);

  // Action: Reset timer
  const reset = useCallback(() => {
    wakeLockService.release();
    notifications.cancelScheduledNotification();

    const wasStarted = statusRef.current === 'RUNNING' || statusRef.current === 'PAUSED';
    if (wasStarted) {
      const serverNow = authService.getServerNow();
      const currentRemaining =
        statusRef.current === 'RUNNING' && targetEndTimeRef.current !== null
          ? Math.max(0, Math.ceil((targetEndTimeRef.current - serverNow) / 1000))
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
  }, [getDurationForType, notifications, publishLocalTimerState, authService]);

  // Action: Skip interval
  const skip = useCallback(() => {
    wakeLockService.release();
    notifications.cancelScheduledNotification();

    const wasStarted = statusRef.current === 'RUNNING' || statusRef.current === 'PAUSED';
    const serverNow = authService.getServerNow();
    const currentRemaining =
      statusRef.current === 'RUNNING' && targetEndTimeRef.current !== null
        ? Math.max(0, Math.ceil((targetEndTimeRef.current - serverNow) / 1000))
        : remainingSecondsRef.current;
    const skippedFromType = sessionTypeRef.current;
    const skippedRunId = timerRunIdRef.current;
    const skippedTotal = totalSecondsRef.current;
    const skippedCycle = currentCycleRef.current;
    const skippedTargetEnd = targetEndTimeRef.current;

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

    if (wasStarted) {
      void telemetryTracker.onSessionFinalized({
        attemptId: skippedRunId,
        outcome: 'skipped',
        sessionType: skippedFromType,
        plannedDurationSeconds: skippedTotal,
        remainingSecondsAtEnd: currentRemaining,
        cycleIndex: skippedCycle,
        tagId: activeTagIdRef.current,
        settings: settingsRef.current,
        dailyGoalMinutes: profileRef.current.dailyGoalMinutes,
        coffeeCups: coffeeCupsRef.current,
        wasStarted: true,
        targetEndTimeMs: skippedTargetEnd,
      });
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
  }, [getDurationForType, sound, notifications, publishLocalTimerState, authService]);

  // Action: Previous interval
  const previousInterval = useCallback(() => {
    wakeLockService.release();
    notifications.cancelScheduledNotification();

    const wasStarted = statusRef.current === 'RUNNING' || statusRef.current === 'PAUSED';
    const serverNow = authService.getServerNow();
    const currentRemaining =
      statusRef.current === 'RUNNING' && targetEndTimeRef.current !== null
        ? Math.max(0, Math.ceil((targetEndTimeRef.current - serverNow) / 1000))
        : remainingSecondsRef.current;
    const prevFromType = sessionTypeRef.current;
    const prevRunId = timerRunIdRef.current;
    const prevTotal = totalSecondsRef.current;
    const prevCycleVal = currentCycleRef.current;
    const prevTargetEnd = targetEndTimeRef.current;

    const prev = computePreviousInterval(
      sessionTypeRef.current,
      currentCycleRef.current,
      settingsRef.current
    );

    const prevType = prev.previousType;
    const prevCycle = prev.previousCycle;
    const prevDuration = prev.previousDuration;

    if (wasStarted) {
      void telemetryTracker.onSessionFinalized({
        attemptId: prevRunId,
        outcome: 'switched',
        sessionType: prevFromType,
        plannedDurationSeconds: prevTotal,
        remainingSecondsAtEnd: currentRemaining,
        cycleIndex: prevCycleVal,
        tagId: activeTagIdRef.current,
        settings: settingsRef.current,
        dailyGoalMinutes: profileRef.current.dailyGoalMinutes,
        coffeeCups: coffeeCupsRef.current,
        wasStarted: true,
        targetEndTimeMs: prevTargetEnd,
      });
    }

    targetEndTimeRef.current = null;
    timerRunIdRef.current = null;
    sessionTypeRef.current = prevType;
    currentCycleRef.current = prevCycle;
    statusRef.current = 'IDLE';
    remainingSecondsRef.current = prevDuration;
    totalSecondsRef.current = prevDuration;

    setSessionType(prevType);
    setCurrentCycle(prevCycle);
    setStatus('IDLE');
    setRemainingSeconds(prevDuration);
    setTotalSeconds(prevDuration);
    setTargetEndTime(null);

    const nowMs = Date.now();
    publishLocalTimerState(
      {
        sessionType: prevType,
        status: 'IDLE',
        remainingSeconds: prevDuration,
        totalSeconds: prevDuration,
        targetEndTime: null,
        currentCycle: prevCycle,
        activeTagId: activeTagIdRef.current,
        timerRunId: null,
        updatedAtMs: nowMs,
      },
      true
    );
  }, [notifications, publishLocalTimerState, authService]);

  const toggleStartPause = useCallback(() => {
    if (statusRef.current === 'RUNNING') {
      pause();
    } else {
      start();
    }
  }, [pause, start]);

  const value: TimerContextValue = {
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

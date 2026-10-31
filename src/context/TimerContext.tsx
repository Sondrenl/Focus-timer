import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { SessionType, TimerStatus, TimerState } from '../types/timer';
import { UserSettings } from '../types/settings';
import { useApp } from './AppContext';
import { triggerCompletionConfetti } from '../utils/confetti';
import { AuthService, RemoteTimerState, PeerPresence, isMobileDevice } from '../services/auth/AuthService';
import { broadcastTimerState, subscribeTimerState, subscribeReset, TAB_ID } from '../services/timer/TimerBroadcast';
import { wakeLockService } from '../services/screen/WakeLockService';
import { useConvexTimer } from '../hooks/useConvexTimer';

const WORKER_SCRIPT = `
  let timerId = null;
  self.onmessage = function(e) {
    if (e.data === 'START') {
      if (!timerId) {
        timerId = setInterval(function() {
          self.postMessage('TICK');
        }, 250);
      }
    } else if (e.data === 'STOP') {
      if (timerId) {
        clearInterval(timerId);
        timerId = null;
      }
    }
  };
`;

const TIMER_STORAGE_KEY = 'timer_state_v1';
const DEVICE_ID_KEY = 'focus_timer_device_id_v1';
const SESSION_ALIVE_KEY = 'focus_timer_session_alive_v1';

const getOrCreateDeviceId = (): string => {
  if (typeof window === 'undefined') return 'server';
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `dev-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return `dev-${Date.now()}`;
  }
};

const DEVICE_ID = getOrCreateDeviceId();
const IS_MOBILE = isMobileDevice();

export const DEVICE_SESSION_ID = `${DEVICE_ID}_${TAB_ID}`;

interface SavedTimerState {
  sessionType: SessionType;
  status: TimerStatus;
  currentCycle: number;
  remainingSeconds: number;
  totalSeconds: number;
  targetEndTime: number | null;
  timerRunId: string | null;
  updatedAtMs: number;
  activeTagId: string | null;
  deviceId: string;
  tabId: string;
  lastActiveAtMs: number;
  wasHidden?: boolean;
}

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
    auth,
    syncWithCloud,
    syncRemoteTags,
    syncRemoteCoffeeCups,
    sessions,
  } = useApp();

  const authService = AuthService.getInstance();
  const { isConvexConfigured, remoteTimer, mutations: convexTimerMutations } = useConvexTimer(auth.isAuthenticated);
  const convexTimerMutationsRef = useRef(convexTimerMutations);
  convexTimerMutationsRef.current = convexTimerMutations;

  // Retrieve initial duration configured in user preferences
  const getDurationForType = useCallback(
    (type: SessionType): number => {
      switch (type) {
        case 'WORK':
          return Math.round(settings.workDurationMinutes * 60);
        case 'SHORT_BREAK':
          return Math.round(settings.shortBreakDurationMinutes * 60);
        case 'LONG_BREAK':
          return Math.round(settings.longBreakDurationMinutes * 60);
      }
    },
    [settings]
  );

  // Initialize timer state from storage or default to 25 minutes WORK
  const [initialState] = useState<SavedTimerState>(() => {
    const defaultSec = Math.round(settings.workDurationMinutes * 60);
    const fallback: SavedTimerState = {
      sessionType: 'WORK',
      status: 'IDLE',
      currentCycle: 1,
      remainingSeconds: defaultSec,
      totalSeconds: defaultSec,
      targetEndTime: null,
      timerRunId: null,
      updatedAtMs: Date.now(),
      activeTagId: null,
      deviceId: DEVICE_ID,
      tabId: TAB_ID,
      lastActiveAtMs: Date.now(),
      wasHidden: false,
    };

    if (typeof window === 'undefined') return fallback;

    try {
      const stored = localStorage.getItem(TIMER_STORAGE_KEY);
      if (!stored) return fallback;
      const parsed = JSON.parse(stored) as SavedTimerState;

      // Handle running timers across tab restarts or browser crashes
      if (parsed.status === 'RUNNING' && parsed.targetEndTime) {
        const now = Date.now();
        const diffMs = parsed.targetEndTime - now;
        const diffSec = Math.max(0, Math.ceil(diffMs / 1000));

        if (diffSec <= 0) {
          // If session expired more than 15 minutes ago while closed, reset to IDLE without recording stale session
          if (diffMs < -900000) {
            return {
              ...parsed,
              status: 'IDLE',
              targetEndTime: null,
              timerRunId: null,
              remainingSeconds: parsed.totalSeconds,
            };
          }
          // Expired while closed, preserve state so mount effect can record and alert
          return {
            ...parsed,
            remainingSeconds: 0,
          };
        }

        return {
          ...parsed,
          remainingSeconds: diffSec,
        };
      }

      return parsed;
    } catch {
      return fallback;
    }
  });

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
  const isApplyingRemoteRef = useRef<boolean>(false);
  const isInitialMountDoneRef = useRef<boolean>(false);
  const lastRemotePollWallMsRef = useRef<number>(Date.now());
  const pendingPushCountRef = useRef<number>(0);
  const passivePushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevActiveTagIdRef = useRef<string | null>(activeTagId);

  const lastCoffeeSigRef = useRef<string>('');
  const lastTagSigRef = useRef<string>('');
  const tagsVersionRef = useRef<number>(0);
  const coffeeVersionRef = useRef<number>(0);
  const lastTickWallMsRef = useRef<number>(Date.now());
  const isWakeSyncingRef = useRef<boolean>(false);

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

  const isAuthenticatedRef = useRef<boolean>(auth.isAuthenticated);
  isAuthenticatedRef.current = auth.isAuthenticated;

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const lastKnownCloudSessionCompletedAtRef = useRef<string | null>(null);
  const lastVisibilitySyncMsRef = useRef<number>(0);

  /**
   * Determines whether THIS device should play the completion chime and show the notification:
   */
  const shouldThisDeviceAlert = useCallback((type: SessionType): boolean => {
    const isVisible = typeof document !== 'undefined' && document.visibilityState === 'visible';
    const peer = peerPresenceRef.current;

    if (IS_MOBILE) {
      if (isVisible) return true;
      if (type === 'WORK') {
        if (peer.desktopActive && !peer.desktopVisible) {
          return true;
        }
        return !peer.desktopActive;
      } else {
        if (peer.desktopActive && peer.desktopVisible) {
          return false;
        }
        return true;
      }
    } else {
      if (type === 'WORK') {
        return true;
      } else {
        if (isVisible) return true;
        return !peer.mobileActive;
      }
    }
  }, []);

  const lastAlertWallMsRef = useRef<number>(0);
  const lastAlertRunIdRef = useRef<string | null>(null);

  const syncScheduledNotification = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (statusRef.current !== 'RUNNING' || !targetEndTimeRef.current) {
      notifications.cancelScheduledNotification();
      return;
    }

    const currentType = sessionTypeRef.current;
    const shouldAlert = shouldThisDeviceAlert(currentType);
    const runId = timerRunIdRef.current;

    if (settingsRef.current.notificationsEnabled && notifications.hasPermission()) {
      notifications.scheduleTimerNotification(
        targetEndTimeRef.current,
        currentType,
        shouldAlert,
        runId
      );
    } else {
      notifications.cancelScheduledNotification();
    }
  }, [notifications, shouldThisDeviceAlert]);

  const dispatchCompletionAlert = useCallback(
    (completedSessionType: SessionType, runId?: string | null) => {
      const now = Date.now();
      const currentRunId = runId || timerRunIdRef.current;

      if (currentRunId && lastAlertRunIdRef.current === currentRunId) {
        return;
      }

      if (now - lastAlertWallMsRef.current < 4000) {
        return;
      }

      lastAlertWallMsRef.current = now;
      lastAlertRunIdRef.current = currentRunId || null;

      const currentSettings = settingsRef.current;
      const willAlert = shouldThisDeviceAlert(completedSessionType);

      if (!willAlert) {
        return;
      }

      if (currentSettings.notificationsEnabled) {
        const title =
          completedSessionType === 'WORK'
            ? 'Focus interval completed! 🎉'
            : 'Break finished! Ready to focus? ⚡';
        const body =
          completedSessionType === 'WORK'
            ? 'Great job maintaining deep flow state. Time for a well-deserved break.'
            : 'Your break has concluded. Ready to start your next interval?';

        notifications.notify(title, body, false, currentRunId);
      }

      if (currentSettings.soundEnabled) {
        sound.playChime(currentSettings.soundVolume);
      }
    },
    [notifications, sound, shouldThisDeviceAlert]
  );

  // Helper to broadcast and push local timer state changes safely without race conditions
  const publishLocalTimerState = useCallback(
    (payload: RemoteTimerState) => {
      if (passivePushTimerRef.current) {
        clearTimeout(passivePushTimerRef.current);
        passivePushTimerRef.current = null;
      }

      localUpdatedAtRef.current = payload.updatedAtMs;
      lastLocalActionWallMsRef.current = Date.now();

      broadcastTimerState(payload);

      if (isConvexConfigured && isAuthenticatedRef.current) {
        if (payload.status === 'RUNNING') {
          convexTimerMutationsRef.current.startTimer({
            sessionType: payload.sessionType,
            durationSeconds: payload.totalSeconds,
            currentCycle: payload.currentCycle,
            tagId: payload.activeTagId || undefined,
            timerRunId: payload.timerRunId || `run-${Date.now()}`,
          }).catch(console.warn);
        } else if (payload.status === 'PAUSED') {
          convexTimerMutationsRef.current.pauseTimer({
            remainingSeconds: payload.remainingSeconds,
          }).catch(console.warn);
        } else if (payload.status === 'IDLE') {
          convexTimerMutationsRef.current.resetTimer({
            sessionType: payload.sessionType,
            durationSeconds: payload.totalSeconds,
            currentCycle: payload.currentCycle,
            tagId: payload.activeTagId || undefined,
          }).catch(console.warn);
        }
      } else if (isAuthenticatedRef.current) {
        pendingPushCountRef.current += 1;
        authService
          .pushRemoteTimer(payload, DEVICE_SESSION_ID, false)
          .then((res) => {
            if (res?.peerPresence) {
              peerPresenceRef.current = res.peerPresence;
            }
          })
          .finally(() => {
            pendingPushCountRef.current = Math.max(0, pendingPushCountRef.current - 1);
          });
      }
    },
    [authService, isConvexConfigured]
  );

  // Mark initial mount hydration complete after first render cycle so initial tag setup doesn't push IDLE over remote timer
  useEffect(() => {
    const timer = setTimeout(() => {
      isInitialMountDoneRef.current = true;
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  // Manage screen wake lock: keep screen awake while timer is actively running
  useEffect(() => {
    if (status === 'RUNNING') {
      wakeLockService.acquire();
    } else {
      wakeLockService.release();
    }
    return () => {
      wakeLockService.release();
    };
  }, [status]);

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
    try {
      localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(stateToSave));
      sessionStorage.setItem(SESSION_ALIVE_KEY, '1');
    } catch {
      // Storage errors ignored
    }
  }, [sessionType, status, currentCycle, remainingSeconds, totalSeconds, targetEndTime, activeTagId]);

  // Report device unload when the browser tab or app is closed
  useEffect(() => {
    const handlePageHide = (e: PageTransitionEvent) => {
      wakeLockService.release();
      if (e.persisted) return;

      if (isAuthenticatedRef.current) {
        authService.reportDeviceClosed(DEVICE_SESSION_ID);
      }
    };

    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [authService]);

  // Keep audio silent keep-alive running while timer is active
  useEffect(() => {
    if (status === 'RUNNING') {
      sound.startSilentKeepAlive();
    } else {
      sound.stopSilentKeepAlive(false);
    }
    return () => {
      sound.stopSilentKeepAlive(false);
    };
  }, [status, sound]);

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

      let nextType: SessionType;
      let nextCycle = currentCycleRef.current;

      if (completedType === 'WORK') {
        if (currentCycleRef.current >= settingsRef.current.longBreakInterval) {
          nextType = 'LONG_BREAK';
          nextCycle = 1;
        } else {
          nextType = 'SHORT_BREAK';
          nextCycle = currentCycleRef.current + 1;
        }
      } else {
        nextType = 'WORK';
      }

      const nextDuration = getDurationForType(nextType);
      const shouldAutoStart =
        nextType === 'WORK'
          ? settingsRef.current.autoStartPomodoros
          : settingsRef.current.autoStartBreaks;

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
      getDurationForType,
      recordSession,
      sound,
      notifications,
      publishLocalTimerState,
      syncScheduledNotification,
      dispatchCompletionAlert,
    ]
  );

  const handleCompleteRef = useRef(handleComplete);
  handleCompleteRef.current = handleComplete;

  // Method to apply authoritative remote timer state
  const applyRemoteState = useCallback(
    (remote: RemoteTimerState) => {
      const nowMs = Date.now();
      const isRecentCompletion = nowMs - lastAlertWallMsRef.current < 4000;
      const isNewer = remote.updatedAtMs > localUpdatedAtRef.current;

      const isAdoptingActiveRemote =
        !isRecentCompletion &&
        statusRef.current === 'IDLE' &&
        (remote.status === 'RUNNING' || remote.status === 'PAUSED') &&
        remote.updatedAtMs >= localUpdatedAtRef.current;

      if (!isNewer && !isAdoptingActiveRemote) {
        return;
      }

      const now = authService.getServerNow();

      if (
        statusRef.current === 'RUNNING' &&
        targetEndTimeRef.current !== null &&
        !isWakeSyncingRef.current &&
        Math.abs(targetEndTimeRef.current - now) <= 10000 &&
        (remote.status === 'IDLE' || remote.sessionType !== sessionTypeRef.current)
      ) {
        const completedType = sessionTypeRef.current;
        const completedRunId = timerRunIdRef.current || `${completedType.toLowerCase()}-${now}`;
        dispatchCompletionAlert(completedType, completedRunId);
      }

      isWakeSyncingRef.current = false;
      isApplyingRemoteRef.current = true;
      localUpdatedAtRef.current = Math.max(localUpdatedAtRef.current, remote.updatedAtMs);

      if (remote.status === 'RUNNING' && remote.targetEndTime) {
        const diffMs = remote.targetEndTime - now;
        const diffSec = Math.max(0, Math.ceil(diffMs / 1000));

        if (diffSec > 0) {
          sound.startSilentKeepAlive();

          sessionTypeRef.current = remote.sessionType;
          currentCycleRef.current = remote.currentCycle || 1;
          totalSecondsRef.current = remote.totalSeconds;
          remainingSecondsRef.current = diffSec;
          statusRef.current = 'RUNNING';
          setSessionType(remote.sessionType);
          setCurrentCycle(remote.currentCycle || 1);
          setTotalSeconds(remote.totalSeconds);
          timerRunIdRef.current = remote.timerRunId || null;
          if (remote.activeTagId !== undefined && setActiveTagId) {
            prevActiveTagIdRef.current = remote.activeTagId;
            setActiveTagId(remote.activeTagId);
          }

          targetEndTimeRef.current = remote.targetEndTime;
          setTargetEndTime(remote.targetEndTime);
          setRemainingSeconds(diffSec);
          setStatus('RUNNING');
          lastTickWallMsRef.current = Date.now();

          if (settingsRef.current.notificationsEnabled && notifications.hasPermission()) {
            notifications.scheduleTimerNotification(
              Date.now() + diffSec * 1000,
              remote.sessionType,
              true,
              remote.timerRunId
            );
          } else {
            notifications.cancelScheduledNotification();
          }
        } else {
          if (diffMs < -900000) {
            const dur = getDurationForType(remote.sessionType);
            sessionTypeRef.current = remote.sessionType;
            totalSecondsRef.current = dur;
            remainingSecondsRef.current = dur;
            statusRef.current = 'IDLE';
            setSessionType(remote.sessionType);
            setTotalSeconds(dur);
            setRemainingSeconds(dur);
            setStatus('IDLE');
            targetEndTimeRef.current = null;
            setTargetEndTime(null);
            timerRunIdRef.current = null;
            notifications.cancelScheduledNotification();
            sound.stopSilentKeepAlive(false);
            return;
          }

          const expiredLongAgo = diffMs < -60000;
          handleCompleteRef.current(expiredLongAgo);
        }
      } else if (remote.status === 'PAUSED') {
        sessionTypeRef.current = remote.sessionType;
        currentCycleRef.current = remote.currentCycle || 1;
        totalSecondsRef.current = remote.totalSeconds;
        remainingSecondsRef.current = remote.remainingSeconds;
        statusRef.current = 'PAUSED';
        setSessionType(remote.sessionType);
        setCurrentCycle(remote.currentCycle || 1);
        setTotalSeconds(remote.totalSeconds);
        timerRunIdRef.current = remote.timerRunId || null;
        if (remote.activeTagId !== undefined && setActiveTagId) {
          prevActiveTagIdRef.current = remote.activeTagId;
          setActiveTagId(remote.activeTagId);
        }

        sound.stopSilentKeepAlive(true);
        notifications.cancelScheduledNotification();
        targetEndTimeRef.current = null;
        setTargetEndTime(null);
        setRemainingSeconds(remote.remainingSeconds);
        setStatus('PAUSED');
      } else {
        const nextStatus: TimerStatus = remote.status === 'COMPLETED' ? 'IDLE' : remote.status;
        const configuredDur = getDurationForType(remote.sessionType);
        sessionTypeRef.current = remote.sessionType;
        currentCycleRef.current = remote.currentCycle || 1;
        totalSecondsRef.current = configuredDur;
        remainingSecondsRef.current = configuredDur;
        statusRef.current = nextStatus;
        setSessionType(remote.sessionType);
        setCurrentCycle(remote.currentCycle || 1);
        setTotalSeconds(configuredDur);
        timerRunIdRef.current = remote.timerRunId || null;
        if (remote.activeTagId !== undefined && setActiveTagId) {
          prevActiveTagIdRef.current = remote.activeTagId;
          setActiveTagId(remote.activeTagId);
        }

        sound.stopSilentKeepAlive(false);
        notifications.cancelScheduledNotification();
        targetEndTimeRef.current = null;
        setTargetEndTime(null);
        setRemainingSeconds(configuredDur);
        setStatus(nextStatus);
      }

      setTimeout(() => {
        isApplyingRemoteRef.current = false;
      }, 150);
    },
    [
      authService,
      setActiveTagId,
      sound,
      notifications,
      getDurationForType,
      shouldThisDeviceAlert,
      syncScheduledNotification,
      dispatchCompletionAlert,
    ]
  );

  // Adopt live Convex WebSocket timer updates instantly
  useEffect(() => {
    if (!isConvexConfigured || !remoteTimer || isApplyingRemoteRef.current) return;
    if (remoteTimer.peerPresence) {
      peerPresenceRef.current = remoteTimer.peerPresence;
    }
    if (remoteTimer.updatedAtMs > localUpdatedAtRef.current) {
      applyRemoteState({
        sessionType: remoteTimer.sessionType,
        status: remoteTimer.status,
        remainingSeconds: remoteTimer.remainingSeconds,
        totalSeconds: remoteTimer.totalSeconds,
        targetEndTime: remoteTimer.targetEndTime ?? null,
        currentCycle: remoteTimer.currentCycle,
        activeTagId: remoteTimer.activeTagId ?? null,
        timerRunId: remoteTimer.timerRunId ?? null,
        updatedAtMs: remoteTimer.updatedAtMs,
      });
    }
  }, [remoteTimer, isConvexConfigured, applyRemoteState]);

  // Cross-device timer sync engine: fetches from Cloudflare D1 with active device presence headers
  const checkRemoteTimer = useCallback(async () => {
    if (isConvexConfigured) {
      // In Convex, remote updates are pushed reactively over WebSockets.
      // Zero HTTP polling needed!
      return;
    }

    if (!isAuthenticatedRef.current || isApplyingRemoteRef.current || pendingPushCountRef.current > 0) {
      return;
    }

    const fetchStartedWallMs = Date.now();
    lastRemotePollWallMsRef.current = fetchStartedWallMs;
    try {
      const isRunning = statusRef.current === 'RUNNING';
      const result = await authService.fetchRemoteTimer(
        isRunning,
        DEVICE_SESSION_ID,
        tagsVersionRef.current,
        coffeeVersionRef.current
      );
      if (!result) {
        isWakeSyncingRef.current = false;
        return;
      }

      if (typeof result.tagsVersion === 'number') {
        tagsVersionRef.current = result.tagsVersion;
      }
      if (typeof result.coffeeVersion === 'number') {
        coffeeVersionRef.current = result.coffeeVersion;
      }

      if (result.peerPresence) {
        peerPresenceRef.current = result.peerPresence;
        if (statusRef.current === 'RUNNING') {
          syncScheduledNotification();
        }
      }

      if (result.coffeeCups && syncRemoteCoffeeCups) {
        const delSig = (result.deletedCoffeeCupIds || []).join(',');
        const cupsSig = result.coffeeCups.map((c) => `${c.id}:${c.tagId || ''}:${c.date}`).join('|');
        const sig = `${cupsSig}#del#${delSig}`;
        if (sig !== lastCoffeeSigRef.current) {
          lastCoffeeSigRef.current = sig;
          syncRemoteCoffeeCups(result.coffeeCups, result.deletedCoffeeCupIds);
        }
      }

      if (result.tags && syncRemoteTags) {
        const delSig = (result.deletedTagIds || []).join(',');
        const tagsSig = result.tags.map((t) => `${t.id}:${t.name}:${t.color}:${t.isArchived}:${t.updatedAt || ''}`).join('|');
        const sig = `${tagsSig}#del#${delSig}`;
        if (sig !== lastTagSigRef.current) {
          lastTagSigRef.current = sig;
          syncRemoteTags(result.tags, result.deletedTagIds);
        }
      }

      if (
        result.lastSessionCompletedAt &&
        result.lastSessionCompletedAt !== lastKnownCloudSessionCompletedAtRef.current
      ) {
        lastKnownCloudSessionCompletedAtRef.current = result.lastSessionCompletedAt;
        const alreadyHasSession = sessionsRef.current.some(
          (s) => s.completedAt === result.lastSessionCompletedAt
        );
        if (!alreadyHasSession) {
          void syncWithCloud();
        }
      }

      if (
        result.timer &&
        result.timer.updatedAtMs > localUpdatedAtRef.current &&
        !isApplyingRemoteRef.current
      ) {
        applyRemoteState(result.timer);
      }
    } catch {
      isWakeSyncingRef.current = false;
    }
  }, [authService, applyRemoteState, syncScheduledNotification, syncRemoteCoffeeCups, syncRemoteTags, syncWithCloud, isConvexConfigured]);

  const checkRemoteTimerRef = useRef(checkRemoteTimer);
  checkRemoteTimerRef.current = checkRemoteTimer;

  // Main countdown tick execution
  const executeTick = useCallback(() => {
    const currentStatus = statusRef.current;
    const nowWall = Date.now();
    const sleepGapMs = nowWall - lastTickWallMsRef.current;
    lastTickWallMsRef.current = nowWall;

    if (isAuthenticatedRef.current && !isConvexConfigured) {
      let pollIntervalMs: number;
      const isVisible = typeof document !== 'undefined' && document.visibilityState === 'visible';
      if (currentStatus === 'RUNNING') {
        pollIntervalMs = isVisible ? 3000 : 10000;
      } else {
        pollIntervalMs = isVisible ? 10000 : 30000;
      }
      if (nowWall - lastRemotePollWallMsRef.current >= pollIntervalMs) {
        void checkRemoteTimerRef.current();
      }

      if (!IS_MOBILE && sleepGapMs > 4500 && isAuthenticatedRef.current) {
        isWakeSyncingRef.current = true;
        void checkRemoteTimerRef.current();
        return;
      }
    }

    if (currentStatus !== 'RUNNING' || targetEndTimeRef.current === null) {
      return;
    }

    const now = authService.getServerNow();
    const target = targetEndTimeRef.current;
    const diffMs = target - now;
    const diffSec = Math.max(0, Math.ceil(diffMs / 1000));

    if (diffSec <= 0) {
      handleCompleteRef.current();
      return;
    }

    if (diffSec !== remainingSecondsRef.current) {
      remainingSecondsRef.current = diffSec;
      setRemainingSeconds(diffSec);
    }
  }, [authService, isConvexConfigured]);

  // Persistent Web Worker initialization
  useEffect(() => {
    let worker: Worker | null = null;
    let fallbackInterval: ReturnType<typeof setInterval> | null = null;

    try {
      const blob = new Blob([WORKER_SCRIPT], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      worker = new Worker(workerUrl);

      worker.onmessage = (e) => {
        if (e.data === 'TICK') {
          executeTick();
        }
      };

      worker.postMessage('START');
    } catch {
      fallbackInterval = setInterval(executeTick, 250);
    }

    return () => {
      if (worker) {
        worker.postMessage('STOP');
        worker.terminate();
      }
      if (fallbackInterval) {
        clearInterval(fallbackInterval);
      }
    };
  }, [executeTick]);

  // Visibility, pageshow, and focus sync listeners
  useEffect(() => {
    const handleVisibilityOrFocus = () => {
      const isHidden = document.visibilityState === 'hidden';

      if (statusRef.current === 'RUNNING') {
        sound.prepareForPlayback();
      }

      if (isConvexConfigured && isAuthenticatedRef.current) {
        convexTimerMutationsRef.current.updatePresence({
          isMobile: IS_MOBILE,
          isVisible: !isHidden,
        }).catch(() => {});
      } else if (isAuthenticatedRef.current) {
        void checkRemoteTimerRef.current();
        const nowMs = Date.now();
        if (nowMs - lastVisibilitySyncMsRef.current > 20000) {
          lastVisibilitySyncMsRef.current = nowMs;
          void syncWithCloud();
        }
      }

      if (statusRef.current === 'RUNNING' && targetEndTimeRef.current !== null) {
        const nowWall = Date.now();
        const sleepGapMs = nowWall - lastTickWallMsRef.current;
        lastTickWallMsRef.current = nowWall;

        if (!IS_MOBILE && sleepGapMs > 4500 && isAuthenticatedRef.current) {
          isWakeSyncingRef.current = true;
          return;
        }

        const now = authService.getServerNow();
        const diffMs = targetEndTimeRef.current - now;
        const diffSec = Math.max(0, Math.ceil(diffMs / 1000));

        if (diffSec <= 0) {
          handleCompleteRef.current();
          return;
        }

        remainingSecondsRef.current = diffSec;
        setRemainingSeconds(diffSec);

        syncScheduledNotification();

        const stateToSave: SavedTimerState = {
          sessionType: sessionTypeRef.current,
          status: statusRef.current,
          currentCycle: currentCycleRef.current,
          remainingSeconds: diffSec,
          totalSeconds: totalSecondsRef.current,
          targetEndTime: targetEndTimeRef.current,
          timerRunId: timerRunIdRef.current,
          updatedAtMs: localUpdatedAtRef.current,
          activeTagId: activeTagIdRef.current,
          deviceId: DEVICE_ID,
          tabId: TAB_ID,
          lastActiveAtMs: Date.now(),
          wasHidden: isHidden,
        };
        try {
          localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(stateToSave));
        } catch {
          // Storage errors ignored
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('pageshow', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('pageshow', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
    };
  }, [sound, syncScheduledNotification, syncWithCloud, authService, isConvexConfigured]);

  // Main-thread backup countdown timer
  useEffect(() => {
    const backupInterval = setInterval(executeTick, 1000);
    return () => clearInterval(backupInterval);
  }, [executeTick]);

  // Multi-tab BroadcastChannel listener
  useEffect(() => {
    const unsubscribeState = subscribeTimerState((incoming) => {
      if (incoming.updatedAtMs > localUpdatedAtRef.current && !isApplyingRemoteRef.current) {
        applyRemoteState(incoming);
      }
    });

    const unsubscribeReset = subscribeReset((scope) => {
      const defaultDuration = getDurationForType('WORK');
      sessionTypeRef.current = 'WORK';
      statusRef.current = 'IDLE';
      currentCycleRef.current = 1;
      totalSecondsRef.current = defaultDuration;
      remainingSecondsRef.current = defaultDuration;
      targetEndTimeRef.current = null;
      timerRunIdRef.current = null;
      localUpdatedAtRef.current = Date.now();

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
    });

    return () => {
      unsubscribeState();
      unsubscribeReset();
    };
  }, [getDurationForType, sound, notifications, applyRemoteState]);

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

    publishLocalTimerState({
      sessionType: sessionTypeRef.current,
      status: 'RUNNING',
      remainingSeconds: duration,
      totalSeconds: totalSecondsRef.current,
      targetEndTime: calculatedTargetEnd,
      currentCycle: currentCycleRef.current,
      activeTagId: activeTagIdRef.current,
      timerRunId: newRunId,
      updatedAtMs: now,
    });

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
    publishLocalTimerState({
      sessionType: sessionTypeRef.current,
      status: 'PAUSED',
      remainingSeconds: currentRemaining,
      totalSeconds: totalSecondsRef.current,
      targetEndTime: null,
      currentCycle: currentCycleRef.current,
      activeTagId: activeTagIdRef.current,
      timerRunId: timerRunIdRef.current,
      updatedAtMs: nowMs,
    });
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
    publishLocalTimerState({
      sessionType: sessionTypeRef.current,
      status: 'IDLE',
      remainingSeconds: defaultDuration,
      totalSeconds: defaultDuration,
      targetEndTime: null,
      currentCycle: currentCycleRef.current,
      activeTagId: activeTagIdRef.current,
      timerRunId: null,
      updatedAtMs: nowMs,
    });
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
        nextCycle = 1;
      } else {
        nextType = 'SHORT_BREAK';
        nextCycle = currentCycleRef.current + 1;
      }
    } else {
      nextType = 'WORK';
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
    publishLocalTimerState({
      sessionType: nextType,
      status: 'IDLE',
      remainingSeconds: nextDuration,
      totalSeconds: nextDuration,
      targetEndTime: null,
      currentCycle: nextCycle,
      activeTagId: activeTagIdRef.current,
      timerRunId: null,
      updatedAtMs: nowMs,
    });
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
      publishLocalTimerState({
        sessionType: type,
        status: 'IDLE',
        remainingSeconds: duration,
        totalSeconds: duration,
        targetEndTime: null,
        currentCycle: currentCycleRef.current,
        activeTagId: activeTagIdRef.current,
        timerRunId: null,
        updatedAtMs: nowMs,
      });
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

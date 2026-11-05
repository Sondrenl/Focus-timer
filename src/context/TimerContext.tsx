import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { SessionType, TimerStatus, TimerState, RemoteTimerState, PeerPresence } from '../types/timer';
import { UserSettings } from '../types/settings';
import { useApp } from './AppContext';
import { triggerCompletionConfetti } from '../utils/confetti';
import { isMobileDevice } from '../utils/environment';
import { AuthService } from '../services/auth/AuthService';
import { broadcastTimerState, subscribeTimerState, subscribeReset, TAB_ID } from '../services/timer/TimerBroadcast';
import { wakeLockService } from '../services/screen/WakeLockService';
import { useConvexTimer } from '../services/convex/useConvexTimer';
import { formatTime } from '../utils/formatters';
import { computeNextInterval, getDurationForType as getBaseDurationForType } from '../utils/timerTransitions';
import { evaluateDeviceAlert } from '../utils/arbitration';

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
    sessions,
  } = useApp();

  const authService = AuthService.getInstance();
  const { isConvexConfigured, remoteTimer, mutations: convexTimerMutations } = useConvexTimer(auth.isAuthenticated);
  const convexTimerMutationsRef = useRef(convexTimerMutations);
  convexTimerMutationsRef.current = convexTimerMutations;

  // Retrieve initial duration configured in user preferences
  const getDurationForType = useCallback(
    (type: SessionType): number => {
      return getBaseDurationForType(type, settings);
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
  const isInitialMountDoneRef = useRef<boolean>(false);
  const passivePushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const isAuthenticatedRef = useRef<boolean>(auth.isAuthenticated);
  isAuthenticatedRef.current = auth.isAuthenticated;

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  /**
   * Determines whether THIS device should play the completion chime and show the notification:
   */
  const shouldThisDeviceAlert = useCallback((type: SessionType): boolean => {
    const isVisible = typeof document !== 'undefined' && document.visibilityState === 'visible';
    return evaluateDeviceAlert({
      isMobile: IS_MOBILE,
      isVisible,
      peer: peerPresenceRef.current,
      type,
    });
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
            ? 'Pomodor — Focus session complete'
            : 'Pomodor — Break session complete';
        const body =
          completedSessionType === 'WORK'
            ? 'Your focus timer has finished. Time for a break.'
            : 'Your break timer has finished. Time for a focus session.';

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
    (payload: RemoteTimerState, isUserAction = false) => {
      if (passivePushTimerRef.current) {
        clearTimeout(passivePushTimerRef.current);
        passivePushTimerRef.current = null;
      }

      localUpdatedAtRef.current = payload.updatedAtMs;
      if (isUserAction) {
        lastLocalActionWallMsRef.current = Date.now();
      }

      broadcastTimerState(payload);

      if (isConvexConfigured && isAuthenticatedRef.current) {
        if (payload.status === 'RUNNING') {
          convexTimerMutationsRef.current.startTimer({
            sessionType: payload.sessionType,
            durationSeconds: payload.totalSeconds,
            remainingSeconds: payload.remainingSeconds,
            totalSeconds: payload.totalSeconds,
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
      }
    },
    [isConvexConfigured]
  );

  const lastReportedPresenceRef = useRef<{ isMobile: boolean; isVisible: boolean; time: number } | null>(null);

  const reportPresence = useCallback((isVisible: boolean) => {
    if (!isConvexConfigured || !isAuthenticatedRef.current) return;
    const now = Date.now();
    const last = lastReportedPresenceRef.current;
    if (
      last &&
      last.isMobile === IS_MOBILE &&
      last.isVisible === isVisible &&
      now - last.time < 60000
    ) {
      return;
    }
    lastReportedPresenceRef.current = { isMobile: IS_MOBILE, isVisible, time: now };
    convexTimerMutationsRef.current.updatePresence({
      isMobile: IS_MOBILE,
      isVisible,
    }).catch(() => {});
  }, [isConvexConfigured]);

  // Mark initial mount hydration complete after first render cycle so initial tag setup doesn't push IDLE over remote timer
  useEffect(() => {
    const timer = setTimeout(() => {
      isInitialMountDoneRef.current = true;
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  // Register device presence eagerly when authenticated so peers detect each other immediately
  useEffect(() => {
    if (isConvexConfigured && auth.isAuthenticated) {
      reportPresence(typeof document !== 'undefined' ? document.visibilityState !== 'hidden' : true);
    }
  }, [isConvexConfigured, auth.isAuthenticated, reportPresence]);

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
      reportPresence(false);
    };

    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [reportPresence]);

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

  // Synchronize document tab title with timer progress, status, and remaining time
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const mode =
      sessionType === 'WORK'
        ? 'Focus'
        : sessionType === 'SHORT_BREAK'
        ? 'Short Break'
        : 'Long Break';
    const timeFormatted = formatTime(remainingSeconds);

    if (status === 'RUNNING') {
      document.title = `${timeFormatted} | ${mode}`;
    } else if (status === 'PAUSED') {
      document.title = `Paused | ${mode}`;
    } else if (status === 'COMPLETED') {
      document.title = `${mode} Completed!`;
    } else {
      document.title = 'Pomodor - Focus timer';
    }
  }, [status, remainingSeconds, sessionType]);

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
      const hasRecentLocalAction = nowMs - lastLocalActionWallMsRef.current < 1500;
      const isNewer = remote.updatedAtMs > localUpdatedAtRef.current;

      // Only reject remote state if the user directly clicked a button on THIS device
      // in the last 1.5s AND the remote snapshot is older than that button click.
      if (hasRecentLocalAction && !isNewer) {
        return;
      }

      const now = authService.getServerNow();

      // Trigger completion alert when remote signals completion or advances to next interval at end time
      if (
        statusRef.current === 'RUNNING' &&
        (remote.status === 'COMPLETED' ||
          (remote.status === 'IDLE' &&
            remote.sessionType !== sessionTypeRef.current &&
            targetEndTimeRef.current !== null &&
            now >= targetEndTimeRef.current - 5000))
      ) {
        const completedType = sessionTypeRef.current;
        const completedRunId = timerRunIdRef.current || remote.timerRunId || `${completedType.toLowerCase()}-${now}`;
        dispatchCompletionAlert(completedType, completedRunId);
      }

      localUpdatedAtRef.current = Math.max(localUpdatedAtRef.current, remote.updatedAtMs);

      if (remote.status === 'RUNNING' && remote.targetEndTime) {
        const diffMs = remote.targetEndTime - now;
        const diffSec = Math.max(0, Math.ceil(diffMs / 1000));

        if (diffSec > 0) {
          sound.startSilentKeepAlive();
          wakeLockService.acquire();

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
            wakeLockService.release();
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
        wakeLockService.release();
        notifications.cancelScheduledNotification();
        targetEndTimeRef.current = null;
        setTargetEndTime(null);
        setRemainingSeconds(remote.remainingSeconds);
        setStatus('PAUSED');
      } else {
        const nextStatus: TimerStatus = remote.status === 'COMPLETED' ? 'IDLE' : remote.status;
        const dur =
          remote.remainingSeconds && remote.remainingSeconds > 0
            ? remote.remainingSeconds
            : remote.status === 'COMPLETED' && remote.totalSeconds && remote.totalSeconds > 0
            ? remote.totalSeconds
            : getDurationForType(remote.sessionType);
        const tot = remote.totalSeconds && remote.totalSeconds > 0
          ? remote.totalSeconds
          : dur;

        sessionTypeRef.current = remote.sessionType;
        currentCycleRef.current = remote.currentCycle || 1;
        totalSecondsRef.current = tot;
        remainingSecondsRef.current = dur;
        statusRef.current = nextStatus;
        setSessionType(remote.sessionType);
        setCurrentCycle(remote.currentCycle || 1);
        setTotalSeconds(tot);
        timerRunIdRef.current = remote.timerRunId || null;
        if (remote.activeTagId !== undefined && setActiveTagId) {
          prevActiveTagIdRef.current = remote.activeTagId;
          setActiveTagId(remote.activeTagId);
        }

        sound.stopSilentKeepAlive(false);
        wakeLockService.release();
        notifications.cancelScheduledNotification();
        targetEndTimeRef.current = null;
        setTargetEndTime(null);
        setRemainingSeconds(dur);
        setStatus(nextStatus);
      }
    },
    [
      authService,
      setActiveTagId,
      sound,
      notifications,
      getDurationForType,
      syncScheduledNotification,
      dispatchCompletionAlert,
    ]
  );

  const applyRemoteStateRef = useRef(applyRemoteState);
  applyRemoteStateRef.current = applyRemoteState;

  // Adopt live Convex WebSocket timer updates instantly
  useEffect(() => {
    if (!isConvexConfigured || !remoteTimer) return;
    if (remoteTimer.peerPresence) {
      peerPresenceRef.current = remoteTimer.peerPresence;
    }
    const now = Date.now();
    const hasRecentLocalAction = now - lastLocalActionWallMsRef.current < 1500;
    const isNewer = remoteTimer.updatedAtMs > localUpdatedAtRef.current;

    // Adopt remote state unconditionally if no recent local action on this device,
    // or if the remote state timestamp is newer than our local state.
    if (!hasRecentLocalAction || isNewer) {
      applyRemoteStateRef.current({
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
  }, [remoteTimer, isConvexConfigured]);

  // Main countdown tick execution
  const executeTick = useCallback(() => {
    const currentStatus = statusRef.current;
    const nowWall = Date.now();
    lastTickWallMsRef.current = nowWall;



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

      reportPresence(!isHidden);

      if (statusRef.current === 'RUNNING' && targetEndTimeRef.current !== null) {
        const nowWall = Date.now();
        lastTickWallMsRef.current = nowWall;


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
  }, [sound, syncScheduledNotification, reportPresence, authService]);

  // Main-thread backup countdown timer
  useEffect(() => {
    const backupInterval = setInterval(executeTick, 1000);
    return () => clearInterval(backupInterval);
  }, [executeTick]);

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
    }, true);

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
    }, true);
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
    }, true);
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
    }, true);
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
      }, true);
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

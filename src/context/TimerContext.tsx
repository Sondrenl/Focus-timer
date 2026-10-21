import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { SessionType, TimerStatus, TimerState } from '../types/timer';
import { UserSettings } from '../types/settings';
import { useApp } from './AppContext';
import { triggerCompletionConfetti } from '../utils/confetti';
import { AuthService, RemoteTimerState, PeerPresence, isMobileDevice } from '../services/auth/AuthService';
import { broadcastTimerState, subscribeTimerState, subscribeReset, hasActivePeerTabs, TAB_ID } from '../services/timer/TimerBroadcast';
import { wakeLockService } from '../services/screen/WakeLockService';

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
    return 'default-device';
  }
};

const DEVICE_ID = getOrCreateDeviceId();
const DEVICE_SESSION_ID = `${DEVICE_ID}:${TAB_ID}`;
const IS_MOBILE = isMobileDevice();

interface SavedTimerState {
  sessionType: SessionType;
  status: TimerStatus;
  currentCycle: number;
  remainingSeconds: number;
  totalSeconds: number;
  targetEndTime: number | null;
  timerRunId?: string | null;
  updatedAtMs?: number;
  activeTagId?: string | null;
  deviceId?: string;
  tabId?: string;
  lastActiveAtMs?: number;
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
  toggleStartPause: () => void;
  resetTimer: () => void;
  skipInterval: () => void;
  setSessionTypeManually: (type: SessionType) => void;
}

const TimerContext = createContext<TimerContextValue | null>(null);

export const TimerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { auth, settings, activeTagId, setActiveTagId, recordSession, sound, notifications, syncRemoteCoffeeCups, syncRemoteTags, sessions, syncWithCloud } = useApp();
  const authService = AuthService.getInstance();

  // Helper to determine target duration in seconds for given session type
  const getDurationForType = useCallback(
    (type: SessionType): number => {
      switch (type) {
        case 'WORK':
          return Math.max(1, Math.round(settings.workDurationMinutes * 60));
        case 'SHORT_BREAK':
          return Math.max(1, Math.round(settings.shortBreakDurationMinutes * 60));
        case 'LONG_BREAK':
          return Math.max(1, Math.round(settings.longBreakDurationMinutes * 60));
      }
    },
    [settings.workDurationMinutes, settings.shortBreakDurationMinutes, settings.longBreakDurationMinutes]
  );

  // Restore saved state from localStorage if available
  const initialSaved = useRef<SavedTimerState | null>(null);

  if (initialSaved.current === null && typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(TIMER_STORAGE_KEY);
      if (raw) {
        const parsed: SavedTimerState = JSON.parse(raw);
        initialSaved.current = parsed;
      }
      sessionStorage.setItem(SESSION_ALIVE_KEY, '1');
    } catch {
      initialSaved.current = null;
    }
  }

  const [sessionType, setSessionType] = useState<SessionType>(() => {
    return initialSaved.current?.sessionType ?? 'WORK';
  });

  const [currentCycle, setCurrentCycle] = useState<number>(() => {
    return initialSaved.current?.currentCycle ?? 1;
  });

  const [totalSeconds, setTotalSeconds] = useState<number>(() => {
    if (initialSaved.current?.totalSeconds) {
      return initialSaved.current.totalSeconds;
    }
    return getDurationForType(initialSaved.current?.sessionType ?? 'WORK');
  });

  const [remainingSeconds, setRemainingSeconds] = useState<number>(() => {
    if (initialSaved.current) {
      if (initialSaved.current.status === 'RUNNING' && initialSaved.current.targetEndTime) {
        const diffSec = Math.ceil((initialSaved.current.targetEndTime - authService.getServerNow()) / 1000);
        if (diffSec > 0) {
          return diffSec;
        }
        return getDurationForType(initialSaved.current.sessionType);
      }
      if (initialSaved.current.remainingSeconds > 0) {
        return initialSaved.current.remainingSeconds;
      }
    }
    return getDurationForType(initialSaved.current?.sessionType ?? 'WORK');
  });

  const [status, setStatus] = useState<TimerStatus>(() => {
    if (initialSaved.current) {
      if (initialSaved.current.status === 'RUNNING' && initialSaved.current.targetEndTime) {
        if (initialSaved.current.targetEndTime > authService.getServerNow()) {
          return 'RUNNING';
        }
      } else if (initialSaved.current.status === 'PAUSED') {
        return 'PAUSED';
      }
    }
    return 'IDLE';
  });

  const initialTargetEndTime =
    initialSaved.current?.status === 'RUNNING' &&
    initialSaved.current.targetEndTime &&
    initialSaved.current.targetEndTime > authService.getServerNow()
      ? initialSaved.current.targetEndTime
      : null;

  const targetEndTimeRef = useRef<number | null>(initialTargetEndTime);
  const [targetEndTime, setTargetEndTime] = useState<number | null>(() => initialTargetEndTime);

  const timerRunIdRef = useRef<string | null>(initialSaved.current?.timerRunId ?? null);

  // Initialize with saved timestamp or 0 (NOT Date.now()) so any fresh remote timer/tag state is accepted on mount
  const localUpdatedAtRef = useRef<number>(initialSaved.current?.updatedAtMs ?? 0);
  const lastCompletedAtRef = useRef<number>(0);
  const lastAlertedRunIdRef = useRef<string | null>(null);
  const lastLocalActionWallMsRef = useRef<number>(0);
  const pendingPushCountRef = useRef<number>(0);
  const isApplyingRemoteRef = useRef<boolean>(false);
  const isCompletingRef = useRef<boolean>(false);
  const isInitialMountDoneRef = useRef<boolean>(false);
  const prevActiveTagIdRef = useRef<string | null>(activeTagId);
  const workerRef = useRef<Worker | null>(null);
  const passivePushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSwScheduleRefreshMsRef = useRef<number>(0);
  const lastRemotePollWallMsRef = useRef<number>(0);
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
   * - On Mobile (Phone):
   *   - If the phone screen is visible: always alert.
   *   - If the phone screen is off / in the background:
   *     - For Focus (WORK): if a Desktop (laptop) client is actively awake, suppress the phone alert
   *       so only the laptop chimes/notifies.
   *     - For Breaks (SHORT_BREAK / LONG_BREAK): if the laptop is both awake AND visible, let the laptop alert;
   *       if the user closed the laptop lid (or hid the timer) to take a break, the phone chimes and notifies!
   * - On Desktop (Laptop):
   *   - For Focus (WORK): always alert when awake.
   *   - For Breaks: alert if visible, or if no mobile client is connected in the background.
   */
  const shouldThisDeviceAlert = useCallback((type: SessionType): boolean => {
    const isVisible = typeof document !== 'undefined' && document.visibilityState === 'visible';
    const peer = peerPresenceRef.current;

    if (IS_MOBILE) {
      if (isVisible) return true;
      if (type === 'WORK') {
        return !peer.desktopActive;
      } else {
        return !(peer.desktopActive && peer.desktopVisible);
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

  /**
   * Keeps the Service Worker backup notification armed ONLY on the device responsible for alerting.
   */
  const syncScheduledNotification = useCallback(() => {
    if (
      statusRef.current !== 'RUNNING' ||
      targetEndTimeRef.current === null ||
      !settingsRef.current.notificationsEnabled ||
      !notifications.hasPermission()
    ) {
      notifications.cancelScheduledNotification();
      return;
    }

    if (!shouldThisDeviceAlert(sessionTypeRef.current)) {
      notifications.cancelScheduledNotification();
      return;
    }

    const now = authService.getServerNow();
    const diffMs = Math.max(0, targetEndTimeRef.current - now);
    if (diffMs > 0) {
      lastSwScheduleRefreshMsRef.current = Date.now();
      notifications.scheduleTimerNotification(
        Date.now() + diffMs,
        sessionTypeRef.current,
        true,
        timerRunIdRef.current
      );
    }
  }, [authService, notifications, shouldThisDeviceAlert]);

  /**
   * Dispatches the completion notification and chime once per completed runId if this device should alert.
   */
  const dispatchCompletionAlert = useCallback(
    (completedType: SessionType, completedRunId: string) => {
      if (lastAlertedRunIdRef.current === completedRunId) {
        return;
      }

      if (!shouldThisDeviceAlert(completedType)) {
        notifications.cancelScheduledNotification();
        return;
      }

      lastAlertedRunIdRef.current = completedRunId;
      const currentSettings = settingsRef.current;

      if (currentSettings.notificationsEnabled) {
        if (completedType === 'WORK') {
          void notifications.notify(
            'Pomodor \u2014 Focus session complete',
            'Your focus timer has finished. Time for a break.',
            false,
            completedRunId
          );
        } else {
          void notifications.notify(
            'Pomodor \u2014 Break session complete',
            'Your break timer has finished. Time for a focus session.',
            false,
            completedRunId
          );
        }
      } else {
        notifications.cancelScheduledNotification();
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

      if (isAuthenticatedRef.current) {
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
    [authService]
  );

  // Mark initial mount hydration complete after first render cycle so initial tag setup doesn't push IDLE over remote timer
  useEffect(() => {
    const timer = setTimeout(() => {
      isInitialMountDoneRef.current = true;
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  // On mobile, keep silent background audio alive and manage screen wake lock.
  // On desktop, never acquire wake lock unless explicitly requested in settings so closing the laptop lid sleeps immediately.
  useEffect(() => {
    if (IS_MOBILE) {
      sound.startSilentKeepAlive();
    }
    if (status === 'RUNNING' && (IS_MOBILE || settings.keepAwake)) {
      wakeLockService.acquire();
    } else {
      wakeLockService.release();
    }
    return () => {
      wakeLockService.release();
    };
  }, [status, settings.keepAwake, sound]);

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

      // If entering bfcache, do not tear down
      if (e.persisted) return;

      // Immediately inform the cloud that this tab/device is closed so peer devices know right away
      if (isAuthenticatedRef.current) {
        authService.reportDeviceClosed(DEVICE_SESSION_ID);
      }

      if (hasActivePeerTabs()) return;

      sound.stopKeepAliveForUnload();
    };

    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, [authService, sound]);

  // Handle duration settings changes when timer is IDLE
  useEffect(() => {
    if (status === 'IDLE') {
      const newDuration = getDurationForType(sessionType);
      const changed = totalSecondsRef.current !== newDuration || remainingSecondsRef.current !== newDuration;
      totalSecondsRef.current = newDuration;
      remainingSecondsRef.current = newDuration;
      setTotalSeconds(newDuration);
      setRemainingSeconds(newDuration);

      if (changed && isInitialMountDoneRef.current) {
        const now = authService.getServerNow();
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
  }, [sessionType, settings.workDurationMinutes, settings.shortBreakDurationMinutes, settings.longBreakDurationMinutes, status, getDurationForType, authService, publishLocalTimerState]);

  // Handle activeTagId changes: sync tag selection across tabs and cloud
  useEffect(() => {
    if (isApplyingRemoteRef.current) {
      prevActiveTagIdRef.current = activeTagId;
      return;
    }
    if (prevActiveTagIdRef.current === activeTagId) return;

    prevActiveTagIdRef.current = activeTagId;

    // Ignore initial tag hydration on mount so a newly opened tab doesn't overwrite a running remote timer
    if (!isInitialMountDoneRef.current && statusRef.current === 'IDLE') {
      return;
    }

    const now = authService.getServerNow();
    const currentRemaining = targetEndTimeRef.current !== null
      ? Math.max(0, Math.ceil((targetEndTimeRef.current - now) / 1000))
      : remainingSecondsRef.current;

    const payload: RemoteTimerState = {
      sessionType: sessionTypeRef.current,
      status: statusRef.current,
      remainingSeconds: currentRemaining,
      totalSeconds: totalSecondsRef.current,
      targetEndTime: targetEndTimeRef.current,
      currentCycle: currentCycleRef.current,
      activeTagId,
      timerRunId: timerRunIdRef.current,
      updatedAtMs: now,
    };

    publishLocalTimerState(payload);
  }, [activeTagId, authService, publishLocalTimerState]);

  // Start timer helper
  const startTimer = useCallback(
    (overrideSec?: number) => {
      isCompletingRef.current = false;
      isWakeSyncingRef.current = false;
      lastTickWallMsRef.current = Date.now();

      const secToRun = overrideSec !== undefined ? overrideSec : remainingSecondsRef.current;
      const now = authService.getServerNow();
      const target = now + secToRun * 1000;
      const targetWallClockMs = Date.now() + secToRun * 1000;
      const runId = timerRunIdRef.current || `tr-${now}-${Math.random().toString(36).substring(2, 6)}`;

      // Ensure mobile silent keep-alive is running (no-op on desktop)
      sound.startSilentKeepAlive();

      // If manually starting while the app is visible, clear any old notification from the shade
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        notifications.clearActiveNotifications();
      }

      timerRunIdRef.current = runId;
      targetEndTimeRef.current = target;
      statusRef.current = 'RUNNING';
      setTargetEndTime(target);
      setStatus('RUNNING');

      // Schedule backup lock-screen notification via Service Worker if this device should alert
      lastSwScheduleRefreshMsRef.current = Date.now();
      if (settingsRef.current.notificationsEnabled) {
        if (notifications.hasPermission()) {
          if (shouldThisDeviceAlert(sessionTypeRef.current)) {
            notifications.scheduleTimerNotification(targetWallClockMs, sessionTypeRef.current, true, runId);
          } else {
            notifications.cancelScheduledNotification();
          }
        } else {
          notifications.requestPermission().then((granted) => {
            if (granted && statusRef.current === 'RUNNING' && shouldThisDeviceAlert(sessionTypeRef.current)) {
              notifications.scheduleTimerNotification(
                targetWallClockMs,
                sessionTypeRef.current,
                true,
                timerRunIdRef.current
              );
            }
          });
        }
      }

      const payload: RemoteTimerState = {
        sessionType: sessionTypeRef.current,
        status: 'RUNNING',
        remainingSeconds: secToRun,
        totalSeconds: totalSecondsRef.current,
        targetEndTime: target,
        currentCycle: currentCycleRef.current,
        activeTagId: activeTagIdRef.current,
        timerRunId: runId,
        updatedAtMs: now,
      };

      publishLocalTimerState(payload);
    },
    [authService, publishLocalTimerState, sound, notifications, shouldThisDeviceAlert]
  );

  // Pause timer helper
  const pauseTimer = useCallback(() => {
    isCompletingRef.current = false;
    isWakeSyncingRef.current = false;
    sound.stopSilentKeepAlive(true);
    notifications.cancelScheduledNotification();

    const now = authService.getServerNow();
    const exactRemaining = targetEndTimeRef.current !== null
      ? Math.max(0, Math.ceil((targetEndTimeRef.current - now) / 1000))
      : remainingSecondsRef.current;

    targetEndTimeRef.current = null;
    statusRef.current = 'PAUSED';
    remainingSecondsRef.current = exactRemaining;
    setTargetEndTime(null);
    setRemainingSeconds(exactRemaining);
    setStatus('PAUSED');

    const payload: RemoteTimerState = {
      sessionType: sessionTypeRef.current,
      status: 'PAUSED',
      remainingSeconds: exactRemaining,
      totalSeconds: totalSecondsRef.current,
      targetEndTime: null,
      currentCycle: currentCycleRef.current,
      activeTagId: activeTagIdRef.current,
      timerRunId: timerRunIdRef.current,
      updatedAtMs: now,
    };

    publishLocalTimerState(payload);
  }, [authService, publishLocalTimerState, sound, notifications]);

  // Reset timer helper
  const resetTimer = useCallback(() => {
    isCompletingRef.current = false;
    isWakeSyncingRef.current = false;
    sound.stopSilentKeepAlive(true);
    notifications.cancelScheduledNotification();

    const now = authService.getServerNow();
    targetEndTimeRef.current = null;
    statusRef.current = 'IDLE';
    setTargetEndTime(null);
    timerRunIdRef.current = null;

    const dur = getDurationForType(sessionTypeRef.current);
    remainingSecondsRef.current = dur;
    totalSecondsRef.current = dur;
    setRemainingSeconds(dur);
    setTotalSeconds(dur);
    setStatus('IDLE');

    const payload: RemoteTimerState = {
      sessionType: sessionTypeRef.current,
      status: 'IDLE',
      remainingSeconds: dur,
      totalSeconds: dur,
      targetEndTime: null,
      currentCycle: currentCycleRef.current,
      activeTagId: activeTagIdRef.current,
      timerRunId: null,
      updatedAtMs: now,
    };

    publishLocalTimerState(payload);
  }, [getDurationForType, authService, publishLocalTimerState, sound, notifications]);

  // Handle completion
  const handleComplete = useCallback(
    (suppressAlertOverride: boolean = false) => {
      if (isCompletingRef.current) return;
      isCompletingRef.current = true;
      isWakeSyncingRef.current = false;
      setTimeout(() => {
        isCompletingRef.current = false;
      }, 1500);

      targetEndTimeRef.current = null;
      setTargetEndTime(null);

      const now = authService.getServerNow();
      lastCompletedAtRef.current = Date.now();
      lastLocalActionWallMsRef.current = Date.now();
      localUpdatedAtRef.current = now;

      const currentType = sessionTypeRef.current;
      const cycle = currentCycleRef.current;
      const currentSettings = settingsRef.current;
      const currentTag = activeTagIdRef.current;
      const currentTotalSec = totalSecondsRef.current;
      const completedRunId = timerRunIdRef.current || `${currentType.toLowerCase()}-${now}`;

      const shouldAlert = !suppressAlertOverride && shouldThisDeviceAlert(currentType);

      if (shouldAlert) {
        dispatchCompletionAlert(currentType, completedRunId);
      } else {
        notifications.cancelScheduledNotification();
      }

      const publishCompletionState = (payload: RemoteTimerState) => {
        if (shouldAlert) {
          publishLocalTimerState(payload);
        } else {
          // Passive follower device: update local tabs immediately and delay cloud push by 1.2s
          // so the active alerting device's completion push lands first without race conditions.
          broadcastTimerState(payload);
          if (passivePushTimerRef.current) {
            clearTimeout(passivePushTimerRef.current);
          }
          passivePushTimerRef.current = setTimeout(() => {
            passivePushTimerRef.current = null;
            if (isAuthenticatedRef.current && localUpdatedAtRef.current <= payload.updatedAtMs) {
              publishLocalTimerState(payload);
            }
          }, 1200);
        }
      };

      if (currentType === 'WORK') {
        if (shouldAlert) {
          triggerCompletionConfetti();
        }

        const runId = timerRunIdRef.current;
        const sessionId = runId
          ? `session-run-${runId}`
          : `session-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

        recordSession({
          id: sessionId,
          tagId: currentTag,
          sessionType: 'WORK',
          durationSeconds: currentTotalSec,
          completedAt: new Date().toISOString(),
        });

        timerRunIdRef.current = null;

        const isLongBreak = cycle >= currentSettings.longBreakInterval;
        const nextType: SessionType = isLongBreak ? 'LONG_BREAK' : 'SHORT_BREAK';
        const dur = isLongBreak
          ? Math.max(1, Math.round(currentSettings.longBreakDurationMinutes * 60))
          : Math.max(1, Math.round(currentSettings.shortBreakDurationMinutes * 60));

        sessionTypeRef.current = nextType;
        totalSecondsRef.current = dur;
        remainingSecondsRef.current = dur;
        setSessionType(nextType);
        setTotalSeconds(dur);
        setRemainingSeconds(dur);

        if (currentSettings.autoStartBreaks) {
          startTimer(dur);
        } else {
          sound.stopSilentKeepAlive(false);
          statusRef.current = 'IDLE';
          setStatus('IDLE');
          const payload: RemoteTimerState = {
            sessionType: nextType,
            status: 'IDLE',
            remainingSeconds: dur,
            totalSeconds: dur,
            targetEndTime: null,
            currentCycle: cycle,
            activeTagId: currentTag,
            timerRunId: null,
            updatedAtMs: now,
          };
          publishCompletionState(payload);
        }
      } else {
        // Break session finished -> Advance to WORK session!
        const dur = Math.max(1, Math.round(currentSettings.workDurationMinutes * 60));
        const nextCycle = currentType === 'SHORT_BREAK' ? cycle + 1 : 1;

        sessionTypeRef.current = 'WORK';
        totalSecondsRef.current = dur;
        remainingSecondsRef.current = dur;
        currentCycleRef.current = nextCycle;
        setSessionType('WORK');
        setTotalSeconds(dur);
        setRemainingSeconds(dur);
        setCurrentCycle(nextCycle);
        timerRunIdRef.current = null;

        if (currentSettings.autoStartPomodoros) {
          startTimer(dur);
        } else {
          sound.stopSilentKeepAlive(false);
          statusRef.current = 'IDLE';
          setStatus('IDLE');
          const payload: RemoteTimerState = {
            sessionType: 'WORK',
            status: 'IDLE',
            remainingSeconds: dur,
            totalSeconds: dur,
            targetEndTime: null,
            currentCycle: nextCycle,
            activeTagId: currentTag,
            timerRunId: null,
            updatedAtMs: now,
          };
          publishCompletionState(payload);
        }
      }
    },
    [
      recordSession,
      sound,
      notifications,
      startTimer,
      authService,
      publishLocalTimerState,
      shouldThisDeviceAlert,
      dispatchCompletionAlert,
    ]
  );

  const handleCompleteRef = useRef(handleComplete);
  handleCompleteRef.current = handleComplete;

  // Core function to safely apply incoming remote/broadcast timer state
  const applyRemoteState = useCallback(
    (remote: RemoteTimerState) => {
      // 1. Guard against dead/expired idle states (never adopt an idle timer with 0 seconds remaining)
      if (remote.status === 'IDLE' && remote.remainingSeconds <= 0) {
        return;
      }

      // 2. Guard against resurrecting an expired session:
      // If we just finished a session locally (within 10 seconds), reject any stale remote
      // state belonging to the session that just finished.
      const isRecentCompletion = Date.now() - lastCompletedAtRef.current < 10000;
      if (isRecentCompletion) {
        const curType = sessionTypeRef.current;
        if (remote.sessionType === 'WORK' && (curType === 'SHORT_BREAK' || curType === 'LONG_BREAK')) {
          return;
        }
        if ((remote.sessionType === 'SHORT_BREAK' || remote.sessionType === 'LONG_BREAK') && curType === 'WORK') {
          return;
        }
      }

      // 3. If both local and remote are already RUNNING the exact same targetEndTime & sessionType,
      // avoid resetting the running timer or flickering state, but keep SW notification synced with peer presence.
      if (
        statusRef.current === 'RUNNING' &&
        remote.status === 'RUNNING' &&
        remote.targetEndTime !== null &&
        targetEndTimeRef.current === remote.targetEndTime &&
        sessionTypeRef.current === remote.sessionType
      ) {
        localUpdatedAtRef.current = Math.max(localUpdatedAtRef.current, remote.updatedAtMs);
        syncScheduledNotification();
        if (remote.activeTagId !== undefined && remote.activeTagId !== activeTagIdRef.current && setActiveTagId) {
          isApplyingRemoteRef.current = true;
          prevActiveTagIdRef.current = remote.activeTagId;
          setActiveTagId(remote.activeTagId);
          setTimeout(() => {
            isApplyingRemoteRef.current = false;
          }, 150);
        }
        return;
      }

      // 4. Freshness check
      const isNewer = remote.updatedAtMs > localUpdatedAtRef.current;

      // 5. Adoption check: Only adopt active remote if:
      // - We are currently IDLE and not in the middle of a recent session completion transition
      // - Remote state is at least as fresh as our local updated timestamp (never adopt older state!)
      const isAdoptingActiveRemote =
        !isRecentCompletion &&
        statusRef.current === 'IDLE' &&
        (remote.status === 'RUNNING' || remote.status === 'PAUSED') &&
        remote.updatedAtMs >= localUpdatedAtRef.current;

      if (!isNewer && !isAdoptingActiveRemote) {
        return;
      }

      const now = authService.getServerNow();

      // If this device was actively RUNNING and within 3.5s of targetEndTime (not waking from sleep)
      // when a peer device pushed the post-completion transition, ensure this device still fires its alert
      // if it is the designated alerting device!
      if (
        statusRef.current === 'RUNNING' &&
        targetEndTimeRef.current !== null &&
        !isWakeSyncingRef.current &&
        Math.abs(targetEndTimeRef.current - now) <= 3500 &&
        (remote.status === 'IDLE' || remote.sessionType !== sessionTypeRef.current)
      ) {
        const completedType = sessionTypeRef.current;
        const completedRunId = timerRunIdRef.current || `${completedType.toLowerCase()}-${now}`;
        dispatchCompletionAlert(completedType, completedRunId);
      }

      isWakeSyncingRef.current = false;
      isApplyingRemoteRef.current = true;
      localUpdatedAtRef.current = Math.max(localUpdatedAtRef.current, remote.updatedAtMs);

      // If remote is RUNNING and targetEndTime is provided
      if (remote.status === 'RUNNING' && remote.targetEndTime) {
        const diffMs = remote.targetEndTime - now;
        const diffSec = Math.max(0, Math.ceil(diffMs / 1000));

        if (diffSec > 0) {
          // Ensure mobile silent keep-alive is active when adopting a remote running timer (e.g. break started on laptop)
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

          if (shouldThisDeviceAlert(remote.sessionType)) {
            notifications.scheduleTimerNotification(
              Date.now() + diffSec * 1000,
              remote.sessionType,
              settingsRef.current.notificationsEnabled,
              remote.timerRunId
            );
          } else {
            notifications.cancelScheduledNotification();
          }
        } else {
          // Target time has already elapsed on the server!
          // If it expired more than 4 seconds ago (e.g. while this laptop was asleep), complete silently.
          const expiredLongAgo = diffMs < -4000;
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
        // IDLE: always use current configured duration for this sessionType so remote IDLE polls never overwrite duration settings
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

  // Cross-device timer sync engine: fetches from Cloudflare D1 with active device presence headers
  const checkRemoteTimer = useCallback(async () => {
    if (!isAuthenticatedRef.current || isApplyingRemoteRef.current || pendingPushCountRef.current > 0) {
      return;
    }

    const fetchStartedWallMs = Date.now();
    lastRemotePollWallMsRef.current = fetchStartedWallMs;
    try {
      const isRunning = statusRef.current === 'RUNNING';
      const result = await authService.fetchRemoteTimer(isRunning, DEVICE_SESSION_ID);
      if (!result) {
        isWakeSyncingRef.current = false;
        return;
      }

      if (result.peerPresence) {
        peerPresenceRef.current = result.peerPresence;
        if (statusRef.current === 'RUNNING') {
          syncScheduledNotification();
        }
      }

      if (result.coffeeCups && syncRemoteCoffeeCups) {
        syncRemoteCoffeeCups(result.coffeeCups, result.deletedCoffeeCupIds);
      }

      if (result.tags && syncRemoteTags) {
        syncRemoteTags(result.tags, result.deletedTagIds);
      }

      if (result.lastSessionCompletedAt) {
        const latestLocalCompletedAt =
          sessionsRef.current.length > 0
            ? sessionsRef.current[sessionsRef.current.length - 1].completedAt
            : null;

        if (!latestLocalCompletedAt || result.lastSessionCompletedAt > latestLocalCompletedAt) {
          if (result.lastSessionCompletedAt !== lastKnownCloudSessionCompletedAtRef.current) {
            lastKnownCloudSessionCompletedAtRef.current = result.lastSessionCompletedAt;
            void syncWithCloud();
          }
        }
      }

      // Discard stale timer payload if a local timer action occurred while this GET was in flight
      if (
        result.timer &&
        pendingPushCountRef.current === 0 &&
        fetchStartedWallMs >= lastLocalActionWallMsRef.current &&
        !isApplyingRemoteRef.current
      ) {
        applyRemoteState(result.timer);
      } else {
        isWakeSyncingRef.current = false;
      }
    } catch (err) {
      isWakeSyncingRef.current = false;
      console.warn('Error checking remote timer', err);
    }
  }, [authService, applyRemoteState, syncRemoteCoffeeCups, syncRemoteTags, syncScheduledNotification, syncWithCloud]);

  const checkRemoteTimerRef = useRef(checkRemoteTimer);
  checkRemoteTimerRef.current = checkRemoteTimer;

  // Shared tick handler used by both the persistent Web Worker and backup interval
  const processTimerTick = useCallback(() => {
    const nowWall = Date.now();
    const sleepGapMs = nowWall - lastTickWallMsRef.current;
    lastTickWallMsRef.current = nowWall;

    // 1. Drive background cloud polling even when the phone screen is off and status is IDLE/PAUSED
    // so a locked phone in the user's pocket immediately detects when a break is started on the laptop.
    if (isAuthenticatedRef.current) {
      const pollIntervalMs = statusRef.current === 'RUNNING' ? 1500 : 2000;
      if (nowWall - lastRemotePollWallMsRef.current >= pollIntervalMs) {
        lastRemotePollWallMsRef.current = nowWall;
        void checkRemoteTimerRef.current();
      }
    }

    // 2. Process active countdown
    if (statusRef.current === 'RUNNING' && targetEndTimeRef.current !== null) {
      // If this device just woke up from OS sleep (e.g. opening the laptop lid after a break),
      // sync with the cloud first before firing local completion so we don't chime late!
      if (!IS_MOBILE && sleepGapMs > 4500 && isAuthenticatedRef.current) {
        isWakeSyncingRef.current = true;
        void checkRemoteTimerRef.current();
        return;
      }

      if (isWakeSyncingRef.current) {
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

      // Renew or cancel Service Worker scheduled notification every 8s while running
      if (nowWall - lastSwScheduleRefreshMsRef.current >= 8000) {
        lastSwScheduleRefreshMsRef.current = nowWall;
        syncScheduledNotification();
      }
    }
  }, [authService, syncScheduledNotification]);

  const processTimerTickRef = useRef(processTimerTick);
  processTimerTickRef.current = processTimerTick;

  // Persistent Web Worker initialization (stays running across IDLE/RUNNING so background polling never freezes)
  useEffect(() => {
    let blobUrl: string | null = null;
    try {
      const blob = new Blob([WORKER_SCRIPT], { type: 'application/javascript' });
      blobUrl = URL.createObjectURL(blob);
      const worker = new Worker(blobUrl);
      workerRef.current = worker;

      worker.onmessage = (e) => {
        if (e.data === 'TICK') {
          processTimerTickRef.current();
        }
      };

      worker.postMessage('START');
    } catch (err) {
      console.warn('Web Worker initialization failed:', err);
    }

    return () => {
      if (passivePushTimerRef.current) {
        clearTimeout(passivePushTimerRef.current);
        passivePushTimerRef.current = null;
      }
      if (workerRef.current) {
        workerRef.current.postMessage('STOP');
        workerRef.current.terminate();
        workerRef.current = null;
      }
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, []);

  // Visibility, pageshow, and focus sync listeners
  useEffect(() => {
    const handleVisibilityOrFocus = () => {
      const isHidden = document.visibilityState === 'hidden';

      if (IS_MOBILE) {
        sound.startSilentKeepAlive();
      }

      // Immediately report visibility transitions (including closing the laptop lid -> hidden!)
      // to the cloud so peer devices know within milliseconds whether the laptop screen is open or closed.
      if (isAuthenticatedRef.current) {
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

        // Update Service Worker scheduled notification based on current visibility & peer presence
        syncScheduledNotification();

        // Persist visibility and latest remaining time snapshot
        const stateToSave: SavedTimerState = {
          sessionType: sessionTypeRef.current,
          status: 'RUNNING',
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
          // Ignore storage error
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);
    window.addEventListener('pageshow', handleVisibilityOrFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      window.removeEventListener('pageshow', handleVisibilityOrFocus);
    };
  }, [authService, sound, syncScheduledNotification, syncWithCloud]);

  // Backup main-thread interval (safeguards countdown & polling if Web Worker is unavailable)
  useEffect(() => {
    const interval = setInterval(() => {
      processTimerTickRef.current();
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Handle expired saved timer on mount
  useEffect(() => {
    if (
      initialSaved.current?.status === 'RUNNING' &&
      initialSaved.current.targetEndTime &&
      initialSaved.current.targetEndTime <= authService.getServerNow()
    ) {
      if (auth.isAuthenticated) {
        isWakeSyncingRef.current = true;
        void checkRemoteTimer();
      } else {
        handleCompleteRef.current();
      }
    }
  }, [auth.isAuthenticated, authService, checkRemoteTimer]);

  // Skip interval helper
  const skipInterval = useCallback(() => {
    isCompletingRef.current = false;
    isWakeSyncingRef.current = false;
    sound.stopSilentKeepAlive(true);
    notifications.cancelScheduledNotification();

    const now = authService.getServerNow();
    targetEndTimeRef.current = null;
    statusRef.current = 'IDLE';
    setTargetEndTime(null);
    timerRunIdRef.current = null;

    const curType = sessionTypeRef.current;
    const curCycle = currentCycleRef.current;
    const curSettings = settingsRef.current;

    let nextType: SessionType = 'WORK';
    let nextCycle = curCycle;
    let nextDur = Math.max(1, Math.round(curSettings.workDurationMinutes * 60));

    if (curType === 'WORK') {
      if (curCycle >= curSettings.longBreakInterval) {
        nextType = 'LONG_BREAK';
        nextDur = Math.max(1, Math.round(curSettings.longBreakDurationMinutes * 60));
      } else {
        nextType = 'SHORT_BREAK';
        nextDur = Math.max(1, Math.round(curSettings.shortBreakDurationMinutes * 60));
      }
    } else if (curType === 'SHORT_BREAK') {
      nextType = 'WORK';
      nextDur = Math.max(1, Math.round(curSettings.workDurationMinutes * 60));
      nextCycle = curCycle + 1;
    } else {
      nextType = 'WORK';
      nextDur = Math.max(1, Math.round(curSettings.workDurationMinutes * 60));
      nextCycle = 1;
    }

    sessionTypeRef.current = nextType;
    currentCycleRef.current = nextCycle;
    totalSecondsRef.current = nextDur;
    remainingSecondsRef.current = nextDur;
    setSessionType(nextType);
    setCurrentCycle(nextCycle);
    setTotalSeconds(nextDur);
    setRemainingSeconds(nextDur);
    setStatus('IDLE');

    const payload: RemoteTimerState = {
      sessionType: nextType,
      status: 'IDLE',
      remainingSeconds: nextDur,
      totalSeconds: nextDur,
      targetEndTime: null,
      currentCycle: nextCycle,
      activeTagId: activeTagIdRef.current,
      timerRunId: null,
      updatedAtMs: now,
    };

    publishLocalTimerState(payload);
  }, [authService, publishLocalTimerState, sound, notifications]);

  // Set session type manually helper
  const setSessionTypeManually = useCallback(
    (type: SessionType) => {
      isCompletingRef.current = false;
      isWakeSyncingRef.current = false;
      sound.stopSilentKeepAlive(true);
      notifications.cancelScheduledNotification();

      const now = authService.getServerNow();
      targetEndTimeRef.current = null;
      statusRef.current = 'IDLE';
      setTargetEndTime(null);
      timerRunIdRef.current = null;

      const dur = getDurationForType(type);
      sessionTypeRef.current = type;
      totalSecondsRef.current = dur;
      remainingSecondsRef.current = dur;
      setSessionType(type);
      setTotalSeconds(dur);
      setRemainingSeconds(dur);
      setStatus('IDLE');

      const payload: RemoteTimerState = {
        sessionType: type,
        status: 'IDLE',
        remainingSeconds: dur,
        totalSeconds: dur,
        targetEndTime: null,
        currentCycle: currentCycleRef.current,
        activeTagId: activeTagIdRef.current,
        timerRunId: null,
        updatedAtMs: now,
      };

      publishLocalTimerState(payload);
    },
    [getDurationForType, authService, publishLocalTimerState, sound, notifications]
  );

  const toggleStartPause = () => {
    if (status === 'RUNNING') {
      pauseTimer();
    } else {
      startTimer();
    }
  };

  // Subscribe to BroadcastChannel for zero-latency multi-tab sync on same machine
  useEffect(() => {
    const unsubscribe = subscribeTimerState((remote) => {
      applyRemoteState(remote);
    });
    return unsubscribe;
  }, [applyRemoteState]);

  // Reset running timer when a wipe or factory reset occurs
  useEffect(() => {
    const unsubscribe = subscribeReset(() => {
      resetTimer();
    });
    return unsubscribe;
  }, [resetTimer]);

  // Check immediately on auth login/mount
  useEffect(() => {
    if (auth.isAuthenticated) {
      void checkRemoteTimer();
    }
  }, [auth.isAuthenticated, checkRemoteTimer]);

  // Tab Title updates
  useEffect(() => {
    const safeSec = Math.max(0, Math.floor(remainingSeconds));
    const mins = Math.floor(safeSec / 60);
    const secs = safeSec % 60;
    const timeFormatted = `${mins}:${secs.toString().padStart(2, '0')}`;
    const badgeLabel =
      sessionType === 'WORK'
        ? 'Focus'
        : sessionType === 'SHORT_BREAK'
        ? 'Short break'
        : 'Long break';

    if (status === 'RUNNING') {
      document.title = `${timeFormatted} - ${badgeLabel}`;
    } else if (status === 'PAUSED') {
      document.title = `Paused - ${badgeLabel}`;
    } else {
      document.title = 'Pomodor - Focus timer';
    }
  }, [remainingSeconds, status, sessionType]);

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
    toggleStartPause,
    resetTimer,
    skipInterval,
    setSessionTypeManually,
  };

  return <TimerContext.Provider value={value}>{children}</TimerContext.Provider>;
};

export const useTimer = (): TimerContextValue => {
  const context = useContext(TimerContext);
  if (!context) {
    throw new Error('useTimer must be used within a TimerProvider');
  }
  return context;
};

export const useTimerContext = useTimer;

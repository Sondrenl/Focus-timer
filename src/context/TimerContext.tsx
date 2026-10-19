import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { SessionType, TimerStatus, TimerState } from '../types/timer';
import { UserSettings } from '../types/settings';
import { useApp } from './AppContext';
import { triggerCompletionConfetti } from '../utils/confetti';
import { AuthService, RemoteTimerState } from '../services/auth/AuthService';
import { broadcastTimerState, subscribeTimerState, hasActivePeerTabs, TAB_ID } from '../services/timer/TimerBroadcast';
import { wakeLockService } from '../services/screen/WakeLockService';

const WORKER_SCRIPT = `
  let timerId = null;
  self.onmessage = function(e) {
    if (e.data === 'START') {
      if (!timerId) {
        timerId = setInterval(function() {
          self.postMessage('TICK');
        }, 200);
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
  const { auth, settings, activeTagId, setActiveTagId, recordSession, sound, notifications, syncRemoteCoffeeCups, syncRemoteTags } = useApp();
  const authService = AuthService.getInstance();

  // Helper to determine target duration in seconds for given session type
  const getDurationForType = useCallback(
    (type: SessionType): number => {
      switch (type) {
        case 'WORK':
          return settings.workDurationMinutes * 60;
        case 'SHORT_BREAK':
          return settings.shortBreakDurationMinutes * 60;
        case 'LONG_BREAK':
          return settings.longBreakDurationMinutes * 60;
      }
    },
    [settings.workDurationMinutes, settings.shortBreakDurationMinutes, settings.longBreakDurationMinutes]
  );

  // Restore saved state from localStorage if available, detecting if the app/browser was killed while running
  const initialSaved = useRef<SavedTimerState | null>(null);
  const killedTimerToPushRef = useRef<RemoteTimerState | null>(null);

  if (initialSaved.current === null && typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(TIMER_STORAGE_KEY);
      if (raw) {
        const parsed: SavedTimerState = JSON.parse(raw);

        if (parsed.status === 'RUNNING' && parsed.targetEndTime) {
          const isOwnedByThisDevice = !parsed.deviceId || parsed.deviceId === DEVICE_ID;
          const hasSessionAlive = sessionStorage.getItem(SESSION_ALIVE_KEY) === '1';
          const navEntries =
            typeof performance !== 'undefined' && performance.getEntriesByType
              ? (performance.getEntriesByType('navigation') as PerformanceNavigationTiming[])
              : [];
          const isReloadNav = navEntries.length > 0 && navEntries[0].type === 'reload';
          const timeSinceLastActive = Date.now() - (parsed.lastActiveAtMs || 0);

          // A quick visible reload (e.g. pressing Cmd+R / F5 while viewing the app) keeps the timer running.
          // Another open tab actively ticking (< 1.5s ago) also keeps it running.
          // Otherwise, if this device owned the running timer and is now cold-starting (because the user
          // swiped up and killed the browser / installed webapp, or closed the tab), stop the timer.
          const isQuickVisibleReload =
            hasSessionAlive && isReloadNav && !parsed.wasHidden && timeSinceLastActive < 4000;
          const isAnotherLocalTabTicking =
            Boolean(parsed.tabId && parsed.tabId !== TAB_ID && timeSinceLastActive < 1500);

          if (isOwnedByThisDevice && !isQuickVisibleReload && !isAnotherLocalTabTicking) {
            const nowServer = authService.getServerNow();
            const stoppedRemaining =
              parsed.remainingSeconds > 0
                ? parsed.remainingSeconds
                : Math.max(1, getDurationForType(parsed.sessionType));

            parsed.status = 'PAUSED';
            parsed.remainingSeconds = stoppedRemaining;
            parsed.targetEndTime = null;
            parsed.updatedAtMs = nowServer;
            parsed.wasHidden = false;
            parsed.lastActiveAtMs = Date.now();

            localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(parsed));

            killedTimerToPushRef.current = {
              sessionType: parsed.sessionType,
              status: 'PAUSED',
              remainingSeconds: stoppedRemaining,
              totalSeconds: parsed.totalSeconds || getDurationForType(parsed.sessionType),
              targetEndTime: null,
              currentCycle: parsed.currentCycle || 1,
              activeTagId: parsed.activeTagId ?? null,
              timerRunId: parsed.timerRunId ?? null,
              updatedAtMs: nowServer,
            };
          }
        }

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
  const lastLocalActionWallMsRef = useRef<number>(killedTimerToPushRef.current ? Date.now() : 0);
  const pendingPushCountRef = useRef<number>(0);
  const isApplyingRemoteRef = useRef<boolean>(false);
  const isCompletingRef = useRef<boolean>(false);
  const isInitialMountDoneRef = useRef<boolean>(false);
  const prevActiveTagIdRef = useRef<string | null>(activeTagId);
  const workerRef = useRef<Worker | null>(null);

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

  // Helper to broadcast and push local timer state changes safely without race conditions
  const publishLocalTimerState = useCallback(
    (payload: RemoteTimerState) => {
      localUpdatedAtRef.current = payload.updatedAtMs;
      lastLocalActionWallMsRef.current = Date.now();

      broadcastTimerState(payload);

      if (isAuthenticatedRef.current) {
        pendingPushCountRef.current += 1;
        authService.pushRemoteTimer(payload).finally(() => {
          pendingPushCountRef.current = Math.max(0, pendingPushCountRef.current - 1);
        });
      }
    },
    [authService]
  );

  // If cold boot detected that the app was killed while a timer was running, push the stopped state to the cloud immediately
  useEffect(() => {
    if (killedTimerToPushRef.current) {
      const payload = killedTimerToPushRef.current;
      killedTimerToPushRef.current = null;
      publishLocalTimerState(payload);
    }
  }, [publishLocalTimerState]);

  // Mark initial mount hydration complete after first render cycle so initial tag setup doesn't push IDLE over remote timer
  useEffect(() => {
    const timer = setTimeout(() => {
      isInitialMountDoneRef.current = true;
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  // Automatically keep screen awake and maintain background audio keep-alive whenever a timer is running
  useEffect(() => {
    if (status === 'RUNNING') {
      wakeLockService.acquire();
    } else {
      wakeLockService.release();
      sound.stopSilentKeepAlive();
    }
    return () => {
      wakeLockService.release();
    };
  }, [status, sound]);

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

  // Stop timer immediately when the browser or installed webapp is killed / closed (pagehide while hidden or tab closed with no peer tabs)
  useEffect(() => {
    const handlePageHide = (e: PageTransitionEvent) => {
      wakeLockService.release();

      // If entering bfcache, do not stop
      if (e.persisted) return;

      // If another tab of the app is still open in the same browser, let that tab continue running the timer
      if (hasActivePeerTabs()) return;

      if (statusRef.current === 'RUNNING') {
        const isHiddenKill = document.visibilityState === 'hidden';
        const now = authService.getServerNow();
        const exactRemaining =
          targetEndTimeRef.current !== null
            ? Math.max(1, Math.ceil((targetEndTimeRef.current - now) / 1000))
            : Math.max(1, remainingSecondsRef.current);

        if (isHiddenKill) {
          // App was in the background / OS App Switcher and is now being terminated
          sound.stopSilentKeepAlive();
          const stoppedState: SavedTimerState = {
            sessionType: sessionTypeRef.current,
            status: 'PAUSED',
            currentCycle: currentCycleRef.current,
            remainingSeconds: exactRemaining,
            totalSeconds: totalSecondsRef.current,
            targetEndTime: null,
            timerRunId: timerRunIdRef.current,
            updatedAtMs: now,
            activeTagId: activeTagIdRef.current,
            deviceId: DEVICE_ID,
            tabId: TAB_ID,
            lastActiveAtMs: Date.now(),
            wasHidden: false,
          };
          try {
            localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(stoppedState));
          } catch {
            // Ignore
          }

          if (isAuthenticatedRef.current) {
            authService.pushRemoteTimer({
              sessionType: sessionTypeRef.current,
              status: 'PAUSED',
              remainingSeconds: exactRemaining,
              totalSeconds: totalSecondsRef.current,
              targetEndTime: null,
              currentCycle: currentCycleRef.current,
              activeTagId: activeTagIdRef.current,
              timerRunId: timerRunIdRef.current,
              updatedAtMs: now,
            });
          }
        } else {
          // Visible unload: could be either a page refresh (Cmd+R) or closing the tab (Cmd+W).
          // Save the exact remaining snapshot so if it was a tab close, the next cold boot stops at this exact second.
          const snapshotState: SavedTimerState = {
            sessionType: sessionTypeRef.current,
            status: 'RUNNING',
            currentCycle: currentCycleRef.current,
            remainingSeconds: exactRemaining,
            totalSeconds: totalSecondsRef.current,
            targetEndTime: targetEndTimeRef.current,
            timerRunId: timerRunIdRef.current,
            updatedAtMs: localUpdatedAtRef.current,
            activeTagId: activeTagIdRef.current,
            deviceId: DEVICE_ID,
            tabId: TAB_ID,
            lastActiveAtMs: Date.now(),
            wasHidden: false,
          };
          try {
            localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(snapshotState));
          } catch {
            // Ignore
          }
        }
      }
    };

    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, [authService, sound]);

  // Handle duration settings changes when timer is IDLE
  useEffect(() => {
    if (status === 'IDLE') {
      const newDuration = getDurationForType(sessionType);
      setTotalSeconds(newDuration);
      setRemainingSeconds(newDuration);
    }
  }, [sessionType, settings.workDurationMinutes, settings.shortBreakDurationMinutes, settings.longBreakDurationMinutes, status, getDurationForType]);

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
      const secToRun = overrideSec !== undefined ? overrideSec : remainingSecondsRef.current;
      const now = authService.getServerNow();
      const target = now + secToRun * 1000;
      const runId = timerRunIdRef.current || `tr-${now}-${Math.random().toString(36).substring(2, 6)}`;

      // Start silent Web Audio keep-alive so mobile OS does not suspend the timer when screen is turned off or app is backgrounded
      sound.startSilentKeepAlive();

      timerRunIdRef.current = runId;
      targetEndTimeRef.current = target;
      statusRef.current = 'RUNNING';
      setTargetEndTime(target);
      setStatus('RUNNING');

      if (workerRef.current) {
        workerRef.current.postMessage('START');
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
    [authService, publishLocalTimerState, sound]
  );

  // Pause timer helper
  const pauseTimer = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.postMessage('STOP');
    }
    sound.stopSilentKeepAlive();

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
  }, [authService, publishLocalTimerState, sound]);

  // Reset timer helper
  const resetTimer = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.postMessage('STOP');
    }
    sound.stopSilentKeepAlive();

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
  }, [getDurationForType, authService, publishLocalTimerState, sound]);

  // Handle completion
  const handleComplete = useCallback(() => {
    if (isCompletingRef.current) return;
    isCompletingRef.current = true;
    setTimeout(() => {
      isCompletingRef.current = false;
    }, 1500);

    if (workerRef.current) {
      workerRef.current.postMessage('STOP');
    }
    sound.stopSilentKeepAlive();
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

    if (currentSettings.soundEnabled) {
      if (currentType === 'WORK') {
        sound.playChime(currentSettings.soundVolume);
      } else {
        sound.playBreakComplete(currentSettings.soundVolume);
      }
    }

    if (currentType === 'WORK') {
      notifications.notify('Session Complete!', 'Great focus! Time to take a well-deserved break.');
      triggerCompletionConfetti();

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
        ? currentSettings.longBreakDurationMinutes * 60
        : currentSettings.shortBreakDurationMinutes * 60;

      sessionTypeRef.current = nextType;
      totalSecondsRef.current = dur;
      remainingSecondsRef.current = dur;
      setSessionType(nextType);
      setTotalSeconds(dur);
      setRemainingSeconds(dur);

      if (currentSettings.autoStartBreaks) {
        startTimer(dur);
      } else {
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
        publishLocalTimerState(payload);
      }
    } else {
      // Break session finished -> Advance to WORK session!
      notifications.notify('Break Finished', 'Ready to dive back into deep work?');
      const dur = currentSettings.workDurationMinutes * 60;
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
        publishLocalTimerState(payload);
      }
    }
  }, [
    recordSession,
    sound,
    notifications,
    startTimer,
    authService,
    publishLocalTimerState,
  ]);

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
      // avoid resetting the running timer or flickering state.
      if (
        statusRef.current === 'RUNNING' &&
        remote.status === 'RUNNING' &&
        remote.targetEndTime !== null &&
        targetEndTimeRef.current === remote.targetEndTime &&
        sessionTypeRef.current === remote.sessionType
      ) {
        localUpdatedAtRef.current = Math.max(localUpdatedAtRef.current, remote.updatedAtMs);
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

      isApplyingRemoteRef.current = true;
      localUpdatedAtRef.current = Math.max(localUpdatedAtRef.current, remote.updatedAtMs);

      // If remote is RUNNING and targetEndTime is provided
      if (remote.status === 'RUNNING' && remote.targetEndTime) {
        const now = authService.getServerNow();
        const diffMs = remote.targetEndTime - now;
        const diffSec = Math.max(0, Math.ceil(diffMs / 1000));

        if (diffSec > 0) {
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
          if (workerRef.current) {
            workerRef.current.postMessage('START');
          }
        } else {
          // Target time has already elapsed! Complete session and advance to next!
          handleCompleteRef.current();
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

        if (workerRef.current) {
          workerRef.current.postMessage('STOP');
        }
        sound.stopSilentKeepAlive();
        targetEndTimeRef.current = null;
        setTargetEndTime(null);
        setRemainingSeconds(remote.remainingSeconds);
        setStatus('PAUSED');
      } else {
        // IDLE
        const nextStatus: TimerStatus = remote.status === 'COMPLETED' ? 'IDLE' : remote.status;
        sessionTypeRef.current = remote.sessionType;
        currentCycleRef.current = remote.currentCycle || 1;
        totalSecondsRef.current = remote.totalSeconds;
        remainingSecondsRef.current = remote.remainingSeconds;
        statusRef.current = nextStatus;
        setSessionType(remote.sessionType);
        setCurrentCycle(remote.currentCycle || 1);
        setTotalSeconds(remote.totalSeconds);
        timerRunIdRef.current = remote.timerRunId || null;
        if (remote.activeTagId !== undefined && setActiveTagId) {
          prevActiveTagIdRef.current = remote.activeTagId;
          setActiveTagId(remote.activeTagId);
        }

        if (workerRef.current) {
          workerRef.current.postMessage('STOP');
        }
        sound.stopSilentKeepAlive();
        targetEndTimeRef.current = null;
        setTargetEndTime(null);
        setRemainingSeconds(remote.remainingSeconds);
        setStatus(nextStatus);
      }

      setTimeout(() => {
        isApplyingRemoteRef.current = false;
      }, 150);
    },
    [authService, setActiveTagId, sound]
  );

  // Background Web Worker initialization (created once on mount, never torn down on state updates)
  useEffect(() => {
    let blobUrl: string | null = null;
    try {
      const blob = new Blob([WORKER_SCRIPT], { type: 'application/javascript' });
      blobUrl = URL.createObjectURL(blob);
      const worker = new Worker(blobUrl);
      workerRef.current = worker;

      worker.onmessage = (e) => {
        if (e.data === 'TICK' && statusRef.current === 'RUNNING' && targetEndTimeRef.current !== null) {
          const now = authService.getServerNow();
          const diffMs = targetEndTimeRef.current - now;
          const diffSec = Math.max(0, Math.ceil(diffMs / 1000));

          if (diffSec <= 0) {
            handleCompleteRef.current();
            return;
          }

          setRemainingSeconds(diffSec);
        }
      };

      if (statusRef.current === 'RUNNING' && targetEndTimeRef.current !== null) {
        worker.postMessage('START');
      }
    } catch (err) {
      console.warn('Web Worker initialization failed:', err);
    }

    return () => {
      if (workerRef.current) {
        workerRef.current.postMessage('STOP');
        workerRef.current.terminate();
        workerRef.current = null;
      }
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [authService]);

  // Ensure Web Worker state stays synced with status
  useEffect(() => {
    if (!workerRef.current) return;
    if (status === 'RUNNING' && targetEndTimeRef.current !== null) {
      workerRef.current.postMessage('START');
    } else {
      workerRef.current.postMessage('STOP');
    }
  }, [status]);

  // Visibility, pageshow, and focus sync listeners:
  // Keeps the timer running seamlessly when switching apps, turning off the phone screen, or switching tabs,
  // while recording the visibility snapshot in localStorage so an OS App-Switcher kill can be detected on next cold boot.
  useEffect(() => {
    const syncRemainingTime = () => {
      const isHidden = document.visibilityState === 'hidden';

      if (statusRef.current === 'RUNNING' && targetEndTimeRef.current !== null) {
        const now = authService.getServerNow();
        const diffMs = targetEndTimeRef.current - now;
        const diffSec = Math.max(0, Math.ceil(diffMs / 1000));

        if (diffSec <= 0) {
          handleCompleteRef.current();
          return;
        }

        remainingSecondsRef.current = diffSec;
        setRemainingSeconds(diffSec);

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

    document.addEventListener('visibilitychange', syncRemainingTime);
    window.addEventListener('focus', syncRemainingTime);
    window.addEventListener('pageshow', syncRemainingTime);
    return () => {
      document.removeEventListener('visibilitychange', syncRemainingTime);
      window.removeEventListener('focus', syncRemainingTime);
      window.removeEventListener('pageshow', syncRemainingTime);
    };
  }, [authService]);

  // Backup tick interval when running (safeguards countdown & completion if Web Worker messages are delayed)
  useEffect(() => {
    if (status !== 'RUNNING') return;
    const interval = setInterval(() => {
      if (statusRef.current === 'RUNNING' && targetEndTimeRef.current !== null) {
        const now = authService.getServerNow();
        const diffMs = targetEndTimeRef.current - now;
        const diffSec = Math.max(0, Math.ceil(diffMs / 1000));
        if (diffSec <= 0) {
          handleCompleteRef.current();
        } else {
          remainingSecondsRef.current = diffSec;
          setRemainingSeconds(diffSec);
        }
      }
    }, 500);
    return () => clearInterval(interval);
  }, [status, authService]);

  // Handle expired saved timer on mount
  useEffect(() => {
    if (
      initialSaved.current?.status === 'RUNNING' &&
      initialSaved.current.targetEndTime &&
      initialSaved.current.targetEndTime <= authService.getServerNow()
    ) {
      handleCompleteRef.current();
    }
  }, [authService]);

  // Skip interval helper
  const skipInterval = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.postMessage('STOP');
    }
    sound.stopSilentKeepAlive();

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
    let nextDur = curSettings.workDurationMinutes * 60;

    if (curType === 'WORK') {
      if (curCycle >= curSettings.longBreakInterval) {
        nextType = 'LONG_BREAK';
        nextDur = curSettings.longBreakDurationMinutes * 60;
      } else {
        nextType = 'SHORT_BREAK';
        nextDur = curSettings.shortBreakDurationMinutes * 60;
      }
    } else if (curType === 'SHORT_BREAK') {
      nextType = 'WORK';
      nextDur = curSettings.workDurationMinutes * 60;
      nextCycle = curCycle + 1;
    } else {
      nextType = 'WORK';
      nextDur = curSettings.workDurationMinutes * 60;
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
  }, [authService, publishLocalTimerState, sound]);

  // Set session type manually helper
  const setSessionTypeManually = useCallback(
    (type: SessionType) => {
      if (workerRef.current) {
        workerRef.current.postMessage('STOP');
      }
      sound.stopSilentKeepAlive();

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
    [getDurationForType, authService, publishLocalTimerState, sound]
  );

  const toggleStartPause = () => {
    if (status === 'RUNNING') {
      pauseTimer();
    } else {
      startTimer();
    }
  };

  // Cross-device timer sync engine: fetches from Cloudflare D1 with active heartbeat header
  const checkRemoteTimer = useCallback(async () => {
    if (!isAuthenticatedRef.current || isApplyingRemoteRef.current || pendingPushCountRef.current > 0) {
      return;
    }

    const fetchStartedWallMs = Date.now();
    try {
      const isRunning = statusRef.current === 'RUNNING';
      const result = await authService.fetchRemoteTimer(isRunning);
      if (!result) return;

      if (result.coffeeCups && syncRemoteCoffeeCups) {
        syncRemoteCoffeeCups(result.coffeeCups, result.deletedCoffeeCupIds);
      }

      if (result.tags && syncRemoteTags) {
        syncRemoteTags(result.tags, result.deletedTagIds);
      }

      // Discard stale timer payload if a local timer action occurred while this GET was in flight
      if (
        result.timer &&
        pendingPushCountRef.current === 0 &&
        fetchStartedWallMs >= lastLocalActionWallMsRef.current &&
        !isApplyingRemoteRef.current
      ) {
        applyRemoteState(result.timer);
      }
    } catch (err) {
      console.warn('Error checking remote timer', err);
    }
  }, [authService, applyRemoteState, syncRemoteCoffeeCups, syncRemoteTags]);

  // Subscribe to BroadcastChannel for zero-latency multi-tab sync on same machine
  useEffect(() => {
    const unsubscribe = subscribeTimerState((remote) => {
      applyRemoteState(remote);
    });
    return unsubscribe;
  }, [applyRemoteState]);

  // Check immediately on auth login/mount
  useEffect(() => {
    if (auth.isAuthenticated) {
      checkRemoteTimer();
    }
  }, [auth.isAuthenticated, checkRemoteTimer]);

  // Set up polling interval & visibility/focus sync
  useEffect(() => {
    if (!auth.isAuthenticated) return;

    // Responsive polling: 1500ms when RUNNING (sends heartbeats even in background tabs), 2500ms when IDLE/PAUSED
    const intervalMs = status === 'RUNNING' ? 1500 : 2500;
    const intervalId = setInterval(() => {
      if (statusRef.current === 'RUNNING' || document.visibilityState === 'visible') {
        checkRemoteTimer();
      }
    }, intervalMs);

    // Sync on visibility change (e.g. unlocking phone or switching back to tab)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkRemoteTimer();
      }
    };

    // Sync on window focus
    const handleFocus = () => {
      checkRemoteTimer();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
    };
  }, [auth.isAuthenticated, status, checkRemoteTimer]);

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

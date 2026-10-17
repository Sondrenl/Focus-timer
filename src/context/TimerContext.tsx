import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { SessionType, TimerStatus, TimerState } from '../types/timer';
import { useApp } from './AppContext';
import { triggerCompletionConfetti } from '../utils/confetti';
import { AuthService, RemoteTimerState } from '../services/auth/AuthService';
import { broadcastTimerState, subscribeTimerState } from '../services/timer/TimerBroadcast';
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
  const { auth, settings, activeTagId, setActiveTagId, recordSession, sound, notifications, syncRemoteCoffeeCups } = useApp();
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

  // Restore saved state from localStorage if available
  const initialSaved = useRef<SavedTimerState | null>(null);
  if (initialSaved.current === null && typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(TIMER_STORAGE_KEY);
      if (raw) {
        initialSaved.current = JSON.parse(raw);
      }
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
        const diffSec = Math.max(0, Math.ceil((initialSaved.current.targetEndTime - authService.getServerNow()) / 1000));
        return diffSec;
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
  const isApplyingRemoteRef = useRef<boolean>(false);
  const prevActiveTagIdRef = useRef<string | null>(activeTagId);
  const workerRef = useRef<Worker | null>(null);

  // Sleep detection: track last recorded wall-clock tick timestamp
  const lastTickTimeRef = useRef<number>(Date.now());

  // Automatically keep screen awake whenever a timer is running (mobile & desktop)
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

  // Release wake lock immediately if page is hidden / navigated away
  useEffect(() => {
    const handlePageHide = () => {
      wakeLockService.release();
    };
    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, []);

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
    };
    try {
      localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(stateToSave));
    } catch {
      // Storage errors ignored
    }
  }, [sessionType, status, currentCycle, remainingSeconds, totalSeconds, targetEndTime, activeTagId]);

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
    if (isApplyingRemoteRef.current) return;
    if (prevActiveTagIdRef.current === activeTagId) return;

    prevActiveTagIdRef.current = activeTagId;

    const now = authService.getServerNow();
    lastCompletedAtRef.current = Date.now();
    localUpdatedAtRef.current = now;

    const currentRemaining = targetEndTimeRef.current !== null
      ? Math.max(0, Math.ceil((targetEndTimeRef.current - now) / 1000))
      : remainingSeconds;

    const payload: RemoteTimerState = {
      sessionType,
      status,
      remainingSeconds: currentRemaining,
      totalSeconds,
      targetEndTime: targetEndTimeRef.current,
      currentCycle,
      activeTagId,
      timerRunId: timerRunIdRef.current,
      updatedAtMs: now,
    };

    broadcastTimerState(payload);

    if (auth.isAuthenticated) {
      authService.pushRemoteTimer(payload);
    }
  }, [activeTagId, auth.isAuthenticated, sessionType, status, remainingSeconds, totalSeconds, currentCycle, authService]);

  // Start timer helper
  const startTimer = useCallback(
    (overrideSec?: number) => {
      const secToRun = overrideSec !== undefined ? overrideSec : remainingSeconds;
      const now = authService.getServerNow();
      const target = now + secToRun * 1000;
      const runId = timerRunIdRef.current || `tr-${now}-${Math.random().toString(36).substring(2, 6)}`;

      timerRunIdRef.current = runId;
      targetEndTimeRef.current = target;
      lastTickTimeRef.current = Date.now();
      setTargetEndTime(target);
      setStatus('RUNNING');
      localUpdatedAtRef.current = now;

      if (workerRef.current) {
        workerRef.current.postMessage('START');
      }

      const payload: RemoteTimerState = {
        sessionType,
        status: 'RUNNING',
        remainingSeconds: secToRun,
        totalSeconds,
        targetEndTime: target,
        currentCycle,
        activeTagId,
        timerRunId: runId,
        updatedAtMs: now,
      };

      broadcastTimerState(payload);

      if (auth.isAuthenticated) {
        authService.pushRemoteTimer(payload);
      }
    },
    [remainingSeconds, sessionType, totalSeconds, currentCycle, activeTagId, auth.isAuthenticated, authService]
  );

  // Pause timer helper
  const pauseTimer = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.postMessage('STOP');
    }
    const now = authService.getServerNow();
    const exactRemaining = targetEndTimeRef.current !== null
      ? Math.max(0, Math.ceil((targetEndTimeRef.current - now) / 1000))
      : remainingSeconds;

    targetEndTimeRef.current = null;
    setTargetEndTime(null);
    setRemainingSeconds(exactRemaining);
    setStatus('PAUSED');
    localUpdatedAtRef.current = now;

    const payload: RemoteTimerState = {
      sessionType,
      status: 'PAUSED',
      remainingSeconds: exactRemaining,
      totalSeconds,
      targetEndTime: null,
      currentCycle,
      activeTagId,
      timerRunId: timerRunIdRef.current,
      updatedAtMs: now,
    };

    broadcastTimerState(payload);

    if (auth.isAuthenticated) {
      authService.pushRemoteTimer(payload);
    }
  }, [sessionType, remainingSeconds, totalSeconds, currentCycle, activeTagId, auth.isAuthenticated, authService]);

  // Reset timer helper
  const resetTimer = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.postMessage('STOP');
    }
    const now = authService.getServerNow();
    targetEndTimeRef.current = null;
    setTargetEndTime(null);
    timerRunIdRef.current = null;

    const dur = getDurationForType(sessionType);
    setRemainingSeconds(dur);
    setTotalSeconds(dur);
    setStatus('IDLE');
    localUpdatedAtRef.current = now;

    const payload: RemoteTimerState = {
      sessionType,
      status: 'IDLE',
      remainingSeconds: dur,
      totalSeconds: dur,
      targetEndTime: null,
      currentCycle,
      activeTagId,
      timerRunId: null,
      updatedAtMs: now,
    };

    broadcastTimerState(payload);

    if (auth.isAuthenticated) {
      authService.pushRemoteTimer(payload);
    }
  }, [sessionType, getDurationForType, currentCycle, activeTagId, auth.isAuthenticated, authService]);

  // Handle completion
  const handleComplete = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.postMessage('STOP');
    }
    targetEndTimeRef.current = null;
    setTargetEndTime(null);

    const now = authService.getServerNow();
    localUpdatedAtRef.current = now;

    if (settings.soundEnabled) {
      if (sessionType === 'WORK') {
        sound.playChime(settings.soundVolume);
      } else {
        sound.playBreakComplete(settings.soundVolume);
      }
    }

    if (sessionType === 'WORK') {
      notifications.notify('Session Complete!', 'Great focus! Time to take a well-deserved break.');
      triggerCompletionConfetti();

      const runId = timerRunIdRef.current;
      const sessionId = runId
        ? `session-run-${runId}`
        : `session-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

      recordSession({
        id: sessionId,
        tagId: activeTagId,
        sessionType: 'WORK',
        durationSeconds: totalSeconds,
        completedAt: new Date().toISOString(),
      });

      timerRunIdRef.current = null;

      if (currentCycle >= settings.longBreakInterval) {
        setSessionType('LONG_BREAK');
        const dur = settings.longBreakDurationMinutes * 60;
        setTotalSeconds(dur);
        setRemainingSeconds(dur);
        if (settings.autoStartBreaks) {
          startTimer(dur);
        } else {
          setStatus('IDLE');
          const payload: RemoteTimerState = {
            sessionType: 'LONG_BREAK',
            status: 'IDLE',
            remainingSeconds: dur,
            totalSeconds: dur,
            targetEndTime: null,
            currentCycle,
            activeTagId,
            timerRunId: null,
            updatedAtMs: now,
          };
          broadcastTimerState(payload);
          if (auth.isAuthenticated) {
            authService.pushRemoteTimer(payload);
          }
        }
      } else {
        setSessionType('SHORT_BREAK');
        const dur = settings.shortBreakDurationMinutes * 60;
        setTotalSeconds(dur);
        setRemainingSeconds(dur);
        if (settings.autoStartBreaks) {
          startTimer(dur);
        } else {
          setStatus('IDLE');
          const payload: RemoteTimerState = {
            sessionType: 'SHORT_BREAK',
            status: 'IDLE',
            remainingSeconds: dur,
            totalSeconds: dur,
            targetEndTime: null,
            currentCycle,
            activeTagId,
            timerRunId: null,
            updatedAtMs: now,
          };
          broadcastTimerState(payload);
          if (auth.isAuthenticated) {
            authService.pushRemoteTimer(payload);
          }
        }
      }
    } else {
      notifications.notify('Break Finished', 'Ready to dive back into deep work?');
      setSessionType('WORK');
      const dur = settings.workDurationMinutes * 60;
      setTotalSeconds(dur);
      setRemainingSeconds(dur);

      const nextCycle = sessionType === 'SHORT_BREAK' ? currentCycle + 1 : 1;
      setCurrentCycle(nextCycle);
      timerRunIdRef.current = null;

      if (settings.autoStartPomodoros) {
        startTimer(dur);
      } else {
        setStatus('IDLE');
        const payload: RemoteTimerState = {
          sessionType: 'WORK',
          status: 'IDLE',
          remainingSeconds: dur,
          totalSeconds: dur,
          targetEndTime: null,
          currentCycle: nextCycle,
          activeTagId,
          timerRunId: null,
          updatedAtMs: now,
        };
        broadcastTimerState(payload);
        if (auth.isAuthenticated) {
          authService.pushRemoteTimer(payload);
        }
      }
    }
  }, [
    sessionType,
    currentCycle,
    settings,
    activeTagId,
    totalSeconds,
    recordSession,
    sound,
    notifications,
    startTimer,
    auth.isAuthenticated,
    authService,
  ]);

  // Core function to safely apply incoming remote/broadcast timer state
  const applyRemoteState = useCallback(
    (remote: RemoteTimerState) => {
      // 1. Guard against resurrecting a completed focus session:
      // If we just finished a session locally (within 10 seconds), reject any stale remote
      // WORK session state (especially PAUSED or RUNNING states from the session that just ended).
      const isRecentCompletion = Date.now() - lastCompletedAtRef.current < 10000;
      if (isRecentCompletion) {
        if (remote.sessionType === 'WORK' && (sessionType === 'SHORT_BREAK' || sessionType === 'LONG_BREAK')) {
          return;
        }
      }

      // 2. Freshness check
      const isNewer = remote.updatedAtMs > localUpdatedAtRef.current;

      // 3. Adoption check: Only adopt active remote if:
      // - We are currently IDLE and not in the middle of a recent session completion transition
      // - Remote state is at least as fresh as our local updated timestamp (never adopt older state!)
      const isAdoptingActiveRemote =
        !isRecentCompletion &&
        status === 'IDLE' &&
        (remote.status === 'RUNNING' || remote.status === 'PAUSED') &&
        remote.updatedAtMs >= localUpdatedAtRef.current;

      if (!isNewer && !isAdoptingActiveRemote) {
        return;
      }

      isApplyingRemoteRef.current = true;
      localUpdatedAtRef.current = Math.max(localUpdatedAtRef.current, remote.updatedAtMs);

      setSessionType(remote.sessionType);
      setCurrentCycle(remote.currentCycle || 1);
      setTotalSeconds(remote.totalSeconds);
      timerRunIdRef.current = remote.timerRunId || null;

      if (remote.activeTagId !== undefined && setActiveTagId) {
        prevActiveTagIdRef.current = remote.activeTagId;
        setActiveTagId(remote.activeTagId);
      }

      if (remote.status === 'RUNNING' && remote.targetEndTime) {
        const now = authService.getServerNow();
        const diffMs = remote.targetEndTime - now;
        const diffSec = Math.max(0, Math.ceil(diffMs / 1000));

        if (diffSec > 0) {
          targetEndTimeRef.current = remote.targetEndTime;
          setTargetEndTime(remote.targetEndTime);
          setRemainingSeconds(diffSec);
          setStatus('RUNNING');
          lastTickTimeRef.current = Date.now();
          if (workerRef.current) {
            workerRef.current.postMessage('START');
          }
        } else {
          // Target time has already elapsed
          targetEndTimeRef.current = null;
          setTargetEndTime(null);
          setRemainingSeconds(0);
          setStatus('IDLE');
          if (workerRef.current) {
            workerRef.current.postMessage('STOP');
          }
        }
      } else if (remote.status === 'PAUSED') {
        if (workerRef.current) {
          workerRef.current.postMessage('STOP');
        }
        targetEndTimeRef.current = null;
        setTargetEndTime(null);
        setRemainingSeconds(remote.remainingSeconds);
        setStatus('PAUSED');
      } else {
        // IDLE / COMPLETED
        if (workerRef.current) {
          workerRef.current.postMessage('STOP');
        }
        targetEndTimeRef.current = null;
        setTargetEndTime(null);
        setRemainingSeconds(remote.remainingSeconds);
        setStatus(remote.status);
      }

      setTimeout(() => {
        isApplyingRemoteRef.current = false;
      }, 150);
    },
    [authService, setActiveTagId, status]
  );

  // Sleep / Lid-close handler: pause timer at moment device went to sleep unless another active device kept running
  const handleSleepWake = useCallback(
    async (sleepTimestamp: number) => {
      if (status !== 'RUNNING' || targetEndTimeRef.current === null) return;

      const now = authService.getServerNow();
      // If timer already reached or passed targetEndTime, it naturally completed!
      if (now >= targetEndTimeRef.current || (targetEndTimeRef.current - sleepTimestamp) <= 0) {
        handleComplete();
        return;
      }

      // 1. If authenticated, query cloud to verify if another device took over and is actively running
      if (auth.isAuthenticated) {
        try {
          const res = await authService.fetchRemoteTimer(false);
          if (res && res.timer) {
            // Another device took over or kept running after our sleep started
            if (res.timer.status === 'RUNNING' && res.timer.updatedAtMs > sleepTimestamp) {
              applyRemoteState(res.timer);
              return;
            }
          }
        } catch {
          // Network check failed, proceed to local sleep pause
        }
      }

      // 2. No other active device: pause timer at the moment sleep occurred
      if (workerRef.current) {
        workerRef.current.postMessage('STOP');
      }
      const pausedRemaining = Math.max(0, Math.ceil((targetEndTimeRef.current - sleepTimestamp) / 1000));
      if (pausedRemaining <= 0) {
        handleComplete();
        return;
      }

      targetEndTimeRef.current = null;
      setTargetEndTime(null);
      setRemainingSeconds(pausedRemaining);
      setStatus('PAUSED');
      localUpdatedAtRef.current = sleepTimestamp;

      const payload: RemoteTimerState = {
        sessionType,
        status: 'PAUSED',
        remainingSeconds: pausedRemaining,
        totalSeconds,
        targetEndTime: null,
        currentCycle,
        activeTagId,
        timerRunId: timerRunIdRef.current,
        updatedAtMs: sleepTimestamp,
      };

      broadcastTimerState(payload);
      if (auth.isAuthenticated) {
        authService.pushRemoteTimer(payload);
      }
    },
    [status, auth.isAuthenticated, authService, applyRemoteState, sessionType, totalSeconds, currentCycle, activeTagId, handleComplete]
  );

  // Background Web Worker initialization
  useEffect(() => {
    let blobUrl: string | null = null;
    try {
      const blob = new Blob([WORKER_SCRIPT], { type: 'application/javascript' });
      blobUrl = URL.createObjectURL(blob);
      const worker = new Worker(blobUrl);
      workerRef.current = worker;

      worker.onmessage = (e) => {
        if (e.data === 'TICK' && targetEndTimeRef.current !== null) {
          const now = authService.getServerNow();
          const diffMs = targetEndTimeRef.current - now;
          const diffSec = Math.max(0, Math.ceil(diffMs / 1000));

          // 1. Always prioritize session completion over sleep detection
          if (diffSec <= 0) {
            handleComplete();
            return;
          }

          // 2. Detect sleep / lid close (device suspended for > 6s)
          const wallNow = Date.now();
          const gap = wallNow - lastTickTimeRef.current;
          const sleepTime = lastTickTimeRef.current;
          lastTickTimeRef.current = wallNow;

          if (gap > 6000 && status === 'RUNNING') {
            handleSleepWake(sleepTime);
            return;
          }

          setRemainingSeconds(diffSec);
        }
      };

      if (status === 'RUNNING' && targetEndTimeRef.current !== null) {
        lastTickTimeRef.current = Date.now();
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
  }, [handleComplete, status, authService, handleSleepWake]);

  // Visibility and focus sync listeners for sleep and tick accuracy
  useEffect(() => {
    const handleVisibility = () => {
      if (status === 'RUNNING' && targetEndTimeRef.current !== null) {
        const now = authService.getServerNow();
        const diffMs = targetEndTimeRef.current - now;
        const diffSec = Math.max(0, Math.ceil(diffMs / 1000));

        // 1. Always prioritize session completion over sleep detection
        if (diffSec <= 0) {
          handleComplete();
          return;
        }

        const wallNow = Date.now();
        const gap = wallNow - lastTickTimeRef.current;
        const sleepTime = lastTickTimeRef.current;
        lastTickTimeRef.current = wallNow;

        if (gap > 6000) {
          handleSleepWake(sleepTime);
          return;
        }

        setRemainingSeconds(diffSec);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
    };
  }, [status, handleComplete, authService, handleSleepWake]);

  // Skip interval helper
  const skipInterval = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.postMessage('STOP');
    }
    const now = authService.getServerNow();
    targetEndTimeRef.current = null;
    setTargetEndTime(null);
    timerRunIdRef.current = null;

    let nextType: SessionType = 'WORK';
    let nextCycle = currentCycle;
    let nextDur = settings.workDurationMinutes * 60;

    if (sessionType === 'WORK') {
      if (currentCycle >= settings.longBreakInterval) {
        nextType = 'LONG_BREAK';
        nextDur = settings.longBreakDurationMinutes * 60;
      } else {
        nextType = 'SHORT_BREAK';
        nextDur = settings.shortBreakDurationMinutes * 60;
      }
    } else if (sessionType === 'SHORT_BREAK') {
      nextType = 'WORK';
      nextDur = settings.workDurationMinutes * 60;
      nextCycle = currentCycle + 1;
    } else {
      nextType = 'WORK';
      nextDur = settings.workDurationMinutes * 60;
      nextCycle = 1;
    }

    setSessionType(nextType);
    setCurrentCycle(nextCycle);
    setTotalSeconds(nextDur);
    setRemainingSeconds(nextDur);
    setStatus('IDLE');
    localUpdatedAtRef.current = now;

    const payload: RemoteTimerState = {
      sessionType: nextType,
      status: 'IDLE',
      remainingSeconds: nextDur,
      totalSeconds: nextDur,
      targetEndTime: null,
      currentCycle: nextCycle,
      activeTagId,
      timerRunId: null,
      updatedAtMs: now,
    };

    broadcastTimerState(payload);

    if (auth.isAuthenticated) {
      authService.pushRemoteTimer(payload);
    }
  }, [sessionType, currentCycle, settings, activeTagId, auth.isAuthenticated, authService]);

  // Set session type manually helper
  const setSessionTypeManually = useCallback(
    (type: SessionType) => {
      if (workerRef.current) {
        workerRef.current.postMessage('STOP');
      }
      const now = authService.getServerNow();
      targetEndTimeRef.current = null;
      setTargetEndTime(null);
      timerRunIdRef.current = null;

      setSessionType(type);
      const dur = getDurationForType(type);
      setTotalSeconds(dur);
      setRemainingSeconds(dur);
      setStatus('IDLE');
      localUpdatedAtRef.current = now;

      const payload: RemoteTimerState = {
        sessionType: type,
        status: 'IDLE',
        remainingSeconds: dur,
        totalSeconds: dur,
        targetEndTime: null,
        currentCycle,
        activeTagId,
        timerRunId: null,
        updatedAtMs: now,
      };

      broadcastTimerState(payload);

      if (auth.isAuthenticated) {
        authService.pushRemoteTimer(payload);
      }
    },
    [getDurationForType, currentCycle, activeTagId, auth.isAuthenticated, authService]
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
    if (!auth.isAuthenticated || isApplyingRemoteRef.current) return;

    try {
      const isRunning = status === 'RUNNING';
      const result = await authService.fetchRemoteTimer(isRunning);
      if (!result) return;
      if (result.timer) {
        applyRemoteState(result.timer);
      }
      if (result.coffeeCups && syncRemoteCoffeeCups) {
        syncRemoteCoffeeCups(result.coffeeCups);
      }
    } catch (err) {
      console.warn('Error checking remote timer', err);
    }
  }, [auth.isAuthenticated, authService, applyRemoteState, status, syncRemoteCoffeeCups]);

  // Subscribe to BroadcastChannel for zero-latency multi-tab sync on same machine
  useEffect(() => {
    const unsubscribe = subscribeTimerState((remote) => {
      applyRemoteState(remote);
    });
    return unsubscribe;
  }, [applyRemoteState]);

  // Set up polling interval & visibility sync
  useEffect(() => {
    if (!auth.isAuthenticated) return;

    // Check immediately on auth change or mount
    checkRemoteTimer();

    // Responsive polling: 1500ms when RUNNING (sends heartbeats), 2500ms when IDLE/PAUSED
    const intervalMs = status === 'RUNNING' ? 1500 : 2500;
    const intervalId = setInterval(() => {
      if (document.visibilityState === 'visible') {
        checkRemoteTimer();
      }
    }, intervalMs);

    // Sync immediately on visibility change (e.g. unlocking phone or switching back to tab)
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
      window.removeEventListener('focus', handleVisibility);
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

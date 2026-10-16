import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { SessionType, TimerStatus, TimerState } from '../types/timer';
import { useApp } from './AppContext';
import { triggerCompletionConfetti } from '../utils/confetti';
import { formatTime } from '../utils/formatters';
import { AuthService, RemoteTimerState } from '../services/auth/AuthService';
import { broadcastTimerState, subscribeTimerState } from '../services/timer/TimerBroadcast';

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
  const { auth, settings, activeTagId, setActiveTagId, recordSession, sound, notifications } = useApp();
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
  const isApplyingRemoteRef = useRef<boolean>(false);
  const prevActiveTagIdRef = useRef<string | null>(activeTagId);
  const workerRef = useRef<Worker | null>(null);

  // Persist state to localStorage on updates
  useEffect(() => {
    try {
      const stateToSave: SavedTimerState = {
        sessionType,
        status,
        currentCycle,
        remainingSeconds,
        totalSeconds,
        targetEndTime: targetEndTimeRef.current,
        timerRunId: timerRunIdRef.current,
        updatedAtMs: localUpdatedAtRef.current,
        activeTagId,
      };
      localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(stateToSave));
    } catch {
      // Storage errors ignored
    }
  }, [sessionType, status, currentCycle, remainingSeconds, totalSeconds, activeTagId]);

  // Sync document title with active timer status: "23:30 Pomodor"
  useEffect(() => {
    if (status === 'RUNNING') {
      document.title = `${formatTime(remainingSeconds)} Pomodor`;
    } else if (status === 'PAUSED') {
      document.title = `${formatTime(remainingSeconds)} (Paused) Pomodor`;
    } else {
      document.title = 'Pomodor — Focus Timer';
    }
  }, [status, remainingSeconds]);

  // Update total & remaining if user changes settings while timer is IDLE
  useEffect(() => {
    if (status === 'IDLE' && !isApplyingRemoteRef.current) {
      const dur = getDurationForType(sessionType);
      setTotalSeconds(dur);
      setRemainingSeconds(dur);
    }
  }, [sessionType, status, getDurationForType]);

  // Handle activeTagId changes from user interaction and sync to cloud + local tabs
  useEffect(() => {
    if (prevActiveTagIdRef.current === activeTagId) return;
    prevActiveTagIdRef.current = activeTagId;

    if (isApplyingRemoteRef.current) return;

    const now = authService.getServerNow();
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

          setRemainingSeconds(diffSec);

          if (diffSec <= 0) {
            handleComplete();
          }
        }
      };

      if (status === 'RUNNING' && targetEndTimeRef.current !== null) {
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
  }, [handleComplete, status, authService]);

  // Visibility sync listener for local tick accuracy
  useEffect(() => {
    const handleVisibility = () => {
      if (status === 'RUNNING' && targetEndTimeRef.current !== null) {
        const now = authService.getServerNow();
        const diffMs = targetEndTimeRef.current - now;
        const diffSec = Math.max(0, Math.ceil(diffMs / 1000));
        setRemainingSeconds(diffSec);
        if (diffSec <= 0) {
          handleComplete();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [status, handleComplete, authService]);

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

  // Core function to safely apply incoming remote/broadcast timer state
  const applyRemoteState = useCallback(
    (remote: RemoteTimerState) => {
      // Apply if remote update is newer than local interaction, OR if local timer is IDLE and remote is active
      const isNewer = remote.updatedAtMs > localUpdatedAtRef.current;
      const isAdoptingActiveRemote = status === 'IDLE' && (remote.status === 'RUNNING' || remote.status === 'PAUSED');

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

  // Cross-device timer sync engine: fetches from Cloudflare D1
  const checkRemoteTimer = useCallback(async () => {
    if (!auth.isAuthenticated || isApplyingRemoteRef.current) return;

    try {
      const remote = await authService.fetchRemoteTimer();
      if (!remote) return;
      applyRemoteState(remote);
    } catch (err) {
      console.warn('Error checking remote timer', err);
    }
  }, [auth.isAuthenticated, authService, applyRemoteState]);

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

    // Responsive polling: 1500ms when RUNNING, 2500ms when IDLE/PAUSED
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
      window.removeEventListener('focus', handleFocus);
    };
  }, [auth.isAuthenticated, status, checkRemoteTimer]);

  const state: TimerState = {
    sessionType,
    status,
    remainingSeconds,
    totalSeconds,
    currentCycle,
    maxCycles: settings.longBreakInterval,
    activeTagId,
  };

  return (
    <TimerContext.Provider
      value={{
        state,
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
      }}
    >
      {children}
    </TimerContext.Provider>
  );
};

export const useTimerContext = (): TimerContextValue => {
  const ctx = useContext(TimerContext);
  if (!ctx) throw new Error("useTimer must be used within a TimerProvider");
  return ctx;
};

export function useTimer(): TimerContextValue {
  const ctx = useContext(TimerContext);
  if (!ctx) {
    throw new Error('useTimer must be used within a TimerProvider');
  }
  return ctx;
}

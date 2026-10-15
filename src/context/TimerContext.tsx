import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { SessionType, TimerStatus, TimerState } from '../types/timer';
import { useApp } from './AppContext';
import { triggerCompletionConfetti } from '../utils/confetti';
import { formatTime } from '../utils/formatters';
import { AuthService } from '../services/auth/AuthService';

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

interface SavedTimerState {
  sessionType: SessionType;
  status: TimerStatus;
  currentCycle: number;
  remainingSeconds: number;
  totalSeconds: number;
  targetEndTime: number | null;
  timerRunId?: string | null;
  updatedAtMs?: number;
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
        const diffSec = Math.max(0, Math.ceil((initialSaved.current.targetEndTime - Date.now()) / 1000));
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
        if (initialSaved.current.targetEndTime > Date.now()) {
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
    initialSaved.current.targetEndTime > Date.now()
      ? initialSaved.current.targetEndTime
      : null;

  const targetEndTimeRef = useRef<number | null>(initialTargetEndTime);
  const [targetEndTime, setTargetEndTime] = useState<number | null>(() => initialTargetEndTime);

  const timerRunIdRef = useRef<string | null>(initialSaved.current?.timerRunId ?? null);

  const localUpdatedAtRef = useRef<number>(initialSaved.current?.updatedAtMs ?? Date.now());
  const isApplyingRemoteRef = useRef<boolean>(false);
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
      };
      localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(stateToSave));
    } catch {
      // Storage errors ignored
    }
  }, [sessionType, status, currentCycle, remainingSeconds, totalSeconds]);

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

  // Start timer helper
  const startTimer = useCallback(
    (overrideSec?: number) => {
      const secToRun = overrideSec !== undefined ? overrideSec : remainingSeconds;
      const target = Date.now() + secToRun * 1000;
      const now = Date.now();
      const runId = timerRunIdRef.current || `tr-${now}-${Math.random().toString(36).substring(2, 6)}`;

      timerRunIdRef.current = runId;
      
      targetEndTimeRef.current = target;
      setTargetEndTime(target);
      setStatus('RUNNING');
      localUpdatedAtRef.current = now;

      if (workerRef.current) {
        workerRef.current.postMessage('START');
      }

      if (auth.isAuthenticated) {
        authService.pushRemoteTimer({
          sessionType,
          status: 'RUNNING',
          remainingSeconds: secToRun,
          totalSeconds,
          targetEndTime: target,
          currentCycle,
          activeTagId,
          timerRunId: runId,
          updatedAtMs: now,
        });
      }
    },
    [remainingSeconds, sessionType, totalSeconds, currentCycle, activeTagId, auth.isAuthenticated]
  );

  // Pause timer helper
  const pauseTimer = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.postMessage('STOP');
    }
    const now = Date.now();
    targetEndTimeRef.current = null;
    setTargetEndTime(null);
    setStatus('PAUSED');
    localUpdatedAtRef.current = now;

    if (auth.isAuthenticated) {
      authService.pushRemoteTimer({
        sessionType,
        status: 'PAUSED',
        remainingSeconds,
        totalSeconds,
        targetEndTime: null,
        currentCycle,
        activeTagId,
        timerRunId: timerRunIdRef.current,
        updatedAtMs: now,
      });
    }
  }, [sessionType, remainingSeconds, totalSeconds, currentCycle, activeTagId, auth.isAuthenticated]);

  // Reset timer helper
  const resetTimer = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.postMessage('STOP');
    }
    const now = Date.now();
    targetEndTimeRef.current = null;
    setTargetEndTime(null);
    timerRunIdRef.current = null;
    
    const dur = getDurationForType(sessionType);
    setRemainingSeconds(dur);
    setTotalSeconds(dur);
    setStatus('IDLE');
    localUpdatedAtRef.current = now;

    if (auth.isAuthenticated) {
      authService.pushRemoteTimer({
        sessionType,
        status: 'IDLE',
        remainingSeconds: dur,
        totalSeconds: dur,
        targetEndTime: null,
        currentCycle,
        activeTagId,
        timerRunId: null,
        updatedAtMs: now,
      });
    }
  }, [sessionType, getDurationForType, currentCycle, activeTagId, auth.isAuthenticated]);

  // Handle completion
  const handleComplete = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.postMessage('STOP');
    }
    targetEndTimeRef.current = null;
    setTargetEndTime(null);

    const now = Date.now();
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
          if (auth.isAuthenticated) {
            authService.pushRemoteTimer({
              sessionType: 'LONG_BREAK',
              status: 'IDLE',
              remainingSeconds: dur,
              totalSeconds: dur,
              targetEndTime: null,
              currentCycle,
              activeTagId,
              timerRunId: null,
              updatedAtMs: now,
            });
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
          if (auth.isAuthenticated) {
            authService.pushRemoteTimer({
              sessionType: 'SHORT_BREAK',
              status: 'IDLE',
              remainingSeconds: dur,
              totalSeconds: dur,
              targetEndTime: null,
              currentCycle,
              activeTagId,
              timerRunId: null,
              updatedAtMs: now,
            });
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
        if (auth.isAuthenticated) {
          authService.pushRemoteTimer({
            sessionType: 'WORK',
            status: 'IDLE',
            remainingSeconds: dur,
            totalSeconds: dur,
            targetEndTime: null,
            currentCycle: nextCycle,
            activeTagId,
            timerRunId: null,
            updatedAtMs: now,
          });
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
          const now = Date.now();
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
  }, [handleComplete, status]);

  // Visibility sync listener for local tick accuracy
  useEffect(() => {
    const handleVisibility = () => {
      if (status === 'RUNNING' && targetEndTimeRef.current !== null) {
        const now = Date.now();
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
  }, [status, handleComplete]);

  // Skip interval helper
  const skipInterval = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.postMessage('STOP');
    }
    const now = Date.now();
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

    if (auth.isAuthenticated) {
      authService.pushRemoteTimer({
        sessionType: nextType,
        status: 'IDLE',
        remainingSeconds: nextDur,
        totalSeconds: nextDur,
        targetEndTime: null,
        currentCycle: nextCycle,
        activeTagId,
        timerRunId: null,
        updatedAtMs: now,
      });
    }
  }, [sessionType, currentCycle, settings, activeTagId, auth.isAuthenticated]);

  // Set session type manually helper
  const setSessionTypeManually = useCallback(
    (type: SessionType) => {
      if (workerRef.current) {
        workerRef.current.postMessage('STOP');
      }
      const now = Date.now();
      targetEndTimeRef.current = null;
      setTargetEndTime(null);
      timerRunIdRef.current = null;
      
      setSessionType(type);
      const dur = getDurationForType(type);
      setTotalSeconds(dur);
      setRemainingSeconds(dur);
      setStatus('IDLE');
      localUpdatedAtRef.current = now;

      if (auth.isAuthenticated) {
        authService.pushRemoteTimer({
          sessionType: type,
          status: 'IDLE',
          remainingSeconds: dur,
          totalSeconds: dur,
          targetEndTime: null,
          currentCycle,
          activeTagId,
          timerRunId: null,
          updatedAtMs: now,
        });
      }
    },
    [getDurationForType, currentCycle, activeTagId, auth.isAuthenticated]
  );

  const toggleStartPause = () => {
    if (status === 'RUNNING') {
      pauseTimer();
    } else {
      startTimer();
    }
  };

  // Cross-device timer sync engine
  const checkRemoteTimer = useCallback(async () => {
    if (!auth.isAuthenticated || isApplyingRemoteRef.current) return;

    try {
      const remote = await authService.fetchRemoteTimer();
      if (!remote) return;

      // Only apply if remote update is strictly newer than our last local user interaction
      if (remote.updatedAtMs > localUpdatedAtRef.current) {
        isApplyingRemoteRef.current = true;
        localUpdatedAtRef.current = remote.updatedAtMs;

        setSessionType(remote.sessionType);
        setCurrentCycle(remote.currentCycle || 1);
        setTotalSeconds(remote.totalSeconds);
        timerRunIdRef.current = remote.timerRunId || null;
        

        if (remote.activeTagId !== undefined && setActiveTagId) {
          setActiveTagId(remote.activeTagId);
        }

        if (remote.status === 'RUNNING' && remote.targetEndTime) {
          const diffMs = remote.targetEndTime - Date.now();
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
            // Target time has already passed
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
      }
    } catch (err) {
      console.warn('Error checking remote timer', err);
    }
  }, [auth.isAuthenticated, setActiveTagId]);

  // Set up polling interval & visibility sync
  useEffect(() => {
    if (!auth.isAuthenticated) return;

    // Check immediately on auth change or mount
    checkRemoteTimer();

    // Poll every 3 seconds for active changes
    const intervalId = setInterval(checkRemoteTimer, 3000);

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
  }, [auth.isAuthenticated, checkRemoteTimer]);

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

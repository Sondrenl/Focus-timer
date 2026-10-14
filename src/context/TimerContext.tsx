import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { SessionType, TimerStatus, TimerState } from '../types/timer';
import { useApp } from './AppContext';
import { triggerCompletionConfetti } from '../utils/confetti';
import { formatTime } from '../utils/formatters';

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
  const { settings, activeTagId, recordSession, sound, notifications } = useApp();

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
      };
      localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(stateToSave));
    } catch {
      // Storage errors ignored
    }
  }, [sessionType, status, currentCycle, remainingSeconds, totalSeconds]);

  // Sync document title with active timer status: "23:30 Pomodor" without brackets
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
    if (status === 'IDLE') {
      const dur = getDurationForType(sessionType);
      setTotalSeconds(dur);
      setRemainingSeconds(dur);
    }
  }, [sessionType, status, getDurationForType]);

  // Start timer helper
  const startTimer = useCallback((overrideSec?: number) => {
    const secToRun = overrideSec !== undefined ? overrideSec : remainingSeconds;
    const target = Date.now() + secToRun * 1000;
    targetEndTimeRef.current = target;
    setTargetEndTime(target);
    setStatus('RUNNING');
    if (workerRef.current) {
      workerRef.current.postMessage('START');
    }
  }, [remainingSeconds]);

  // Handle completion
  const handleComplete = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.postMessage('STOP');
    }
    targetEndTimeRef.current = null;
    setTargetEndTime(null);

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
      recordSession({
        tagId: activeTagId,
        sessionType: 'WORK',
        durationSeconds: totalSeconds,
        completedAt: new Date().toISOString(),
      });

      if (currentCycle >= settings.longBreakInterval) {
        setSessionType('LONG_BREAK');
        const dur = settings.longBreakDurationMinutes * 60;
        setTotalSeconds(dur);
        setRemainingSeconds(dur);
        if (settings.autoStartBreaks) {
          startTimer(dur);
        } else {
          setStatus('IDLE');
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
        }
      }
    } else {
      notifications.notify('Break Finished', 'Ready to dive back into deep work?');
      setSessionType('WORK');
      const dur = settings.workDurationMinutes * 60;
      setTotalSeconds(dur);
      setRemainingSeconds(dur);

      if (sessionType === 'SHORT_BREAK') {
        setCurrentCycle((prev) => prev + 1);
      } else {
        setCurrentCycle(1);
      }

      if (settings.autoStartPomodoros) {
        startTimer(dur);
      } else {
        setStatus('IDLE');
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

  // Visibility sync listener
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

  const pauseTimer = () => {
    if (workerRef.current) {
      workerRef.current.postMessage('STOP');
    }
    targetEndTimeRef.current = null;
    setTargetEndTime(null);
    setStatus('PAUSED');
  };

  const toggleStartPause = () => {
    if (status === 'RUNNING') {
      pauseTimer();
    } else {
      startTimer();
    }
  };

  const resetTimer = () => {
    if (workerRef.current) {
      workerRef.current.postMessage('STOP');
    }
    targetEndTimeRef.current = null;
    setTargetEndTime(null);
    const dur = getDurationForType(sessionType);
    setRemainingSeconds(dur);
    setTotalSeconds(dur);
    setStatus('IDLE');
  };

  const skipInterval = () => {
    if (workerRef.current) {
      workerRef.current.postMessage('STOP');
    }
    targetEndTimeRef.current = null;
    setTargetEndTime(null);

    if (sessionType === 'WORK') {
      if (currentCycle >= settings.longBreakInterval) {
        setSessionType('LONG_BREAK');
        const dur = settings.longBreakDurationMinutes * 60;
        setTotalSeconds(dur);
        setRemainingSeconds(dur);
      } else {
        setSessionType('SHORT_BREAK');
        const dur = settings.shortBreakDurationMinutes * 60;
        setTotalSeconds(dur);
        setRemainingSeconds(dur);
      }
    } else if (sessionType === 'SHORT_BREAK') {
      setSessionType('WORK');
      const dur = settings.workDurationMinutes * 60;
      setTotalSeconds(dur);
      setRemainingSeconds(dur);
      setCurrentCycle((prev) => prev + 1);
    } else {
      setSessionType('WORK');
      const dur = settings.workDurationMinutes * 60;
      setTotalSeconds(dur);
      setRemainingSeconds(dur);
      setCurrentCycle(1);
    }
    setStatus('IDLE');
  };

  const setSessionTypeManually = (type: SessionType) => {
    if (workerRef.current) {
      workerRef.current.postMessage('STOP');
    }
    targetEndTimeRef.current = null;
    setTargetEndTime(null);
    setSessionType(type);
    const dur = getDurationForType(type);
    setTotalSeconds(dur);
    setRemainingSeconds(dur);
    setStatus('IDLE');
  };

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

export function useTimerContext(): TimerContextValue {
  const ctx = useContext(TimerContext);
  if (!ctx) {
    throw new Error('useTimerContext must be used within a TimerProvider');
  }
  return ctx;
}

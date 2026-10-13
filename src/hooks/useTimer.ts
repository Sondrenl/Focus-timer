import { useState, useEffect, useRef, useCallback } from 'react';
import { SessionType, TimerStatus, TimerState } from '../types/timer';
import { useApp } from '../context/AppContext';
import { triggerCompletionConfetti } from '../utils/confetti';
import { formatTime } from '../utils/formatters';

/**
 * Worker script string that executes on an independent thread,
 * avoiding background tab throttling by browsers.
 */
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

export function useTimer() {
  const { settings, activeTagId, recordSession, sound, notifications } = useApp();

  const [sessionType, setSessionType] = useState<SessionType>('WORK');
  const [status, setStatus] = useState<TimerStatus>('IDLE');
  const [currentCycle, setCurrentCycle] = useState<number>(1);

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

  const [totalSeconds, setTotalSeconds] = useState<number>(() => getDurationForType('WORK'));
  const [remainingSeconds, setRemainingSeconds] = useState<number>(() => getDurationForType('WORK'));

  // Target end timestamp in milliseconds for drift-free Date.now() calculation
  const targetEndTimeRef = useRef<number | null>(null);
  const workerRef = useRef<Worker | null>(null);

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

  // Initialize and tear down the background Web Worker
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
    } catch (err) {
      console.warn('Web Worker initialization failed, will fallback to main thread timer:', err);
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
  }, []);

  // Window visibility listener for instant sync when tab is reopened/focused
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
  }, [status]);

  /**
   * Called when timer counts down to 0
   */
  const handleComplete = useCallback(() => {
    // Stop worker ticks
    if (workerRef.current) {
      workerRef.current.postMessage('STOP');
    }
    targetEndTimeRef.current = null;

    // Play audible feedback and dispatch desktop notification
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
      // Record completed work session
      recordSession({
        tagId: activeTagId,
        sessionType: 'WORK',
        durationSeconds: totalSeconds,
        completedAt: new Date().toISOString(),
      });

      // Transition to break
      if (currentCycle >= settings.longBreakInterval) {
        // Long break transition - preserve currentCycle at max during the long break
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
        // Short break transition
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
      // Break is complete -> Next work session
      notifications.notify('Break Finished', 'Ready to dive back into deep work?');
      setSessionType('WORK');
      const dur = settings.workDurationMinutes * 60;
      setTotalSeconds(dur);
      setRemainingSeconds(dur);

      if (sessionType === 'SHORT_BREAK') {
        setCurrentCycle((prev) => prev + 1);
      } else {
        // After long break finishes, reset cycle to 1 for the next round
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
  ]);

  const startTimer = (overrideSec?: number) => {
    const secToRun = overrideSec !== undefined ? overrideSec : remainingSeconds;
    targetEndTimeRef.current = Date.now() + secToRun * 1000;
    setStatus('RUNNING');
    if (workerRef.current) {
      workerRef.current.postMessage('START');
    }
  };

  const pauseTimer = () => {
    if (workerRef.current) {
      workerRef.current.postMessage('STOP');
    }
    targetEndTimeRef.current = null;
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

    if (sessionType === 'WORK') {
      if (currentCycle >= settings.longBreakInterval) {
        setSessionType('LONG_BREAK');
        const dur = settings.longBreakDurationMinutes * 60;
        setTotalSeconds(dur);
        setRemainingSeconds(dur);
        // Keep currentCycle at settings.longBreakInterval during long break
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
      // Skipping from LONG_BREAK resets to cycle 1
      setSessionType('WORK');
      const dur = settings.workDurationMinutes * 60;
      setTotalSeconds(dur);
      setRemainingSeconds(dur);
      setCurrentCycle(1);
    }
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

  return {
    state,
    sessionType,
    status,
    remainingSeconds,
    totalSeconds,
    currentCycle,
    maxCycles: settings.longBreakInterval,
    toggleStartPause,
    resetTimer,
    skipInterval,
    setSessionTypeManually: (type: SessionType) => {
      if (workerRef.current) {
        workerRef.current.postMessage('STOP');
      }
      targetEndTimeRef.current = null;
      setSessionType(type);
      const dur = getDurationForType(type);
      setTotalSeconds(dur);
      setRemainingSeconds(dur);
      setStatus('IDLE');
    },
  };
}

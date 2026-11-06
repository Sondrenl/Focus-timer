import React, { useCallback, useEffect } from 'react';
import { SessionType, TimerStatus } from '../../types/timer';
import type { useApp } from '../AppContext';
import { AuthService } from '../../services/auth/AuthService';
import { wakeLockService } from '../../services/screen/WakeLockService';
import { TAB_ID } from '../../services/timer/TimerBroadcast';
import { formatTime } from '../../utils/formatters';
import { DEVICE_ID, SavedTimerState, saveTimerState } from './timerPersistence';

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

interface UseTimerWorkerParams {
  status: TimerStatus;
  sessionType: SessionType;
  remainingSeconds: number;
  statusRef: React.MutableRefObject<TimerStatus>;
  sessionTypeRef: React.MutableRefObject<SessionType>;
  currentCycleRef: React.MutableRefObject<number>;
  remainingSecondsRef: React.MutableRefObject<number>;
  totalSecondsRef: React.MutableRefObject<number>;
  targetEndTimeRef: React.MutableRefObject<number | null>;
  timerRunIdRef: React.MutableRefObject<string | null>;
  localUpdatedAtRef: React.MutableRefObject<number>;
  activeTagIdRef: React.MutableRefObject<string | null>;
  lastTickWallMsRef: React.MutableRefObject<number>;
  handleCompleteRef: React.MutableRefObject<(silent?: boolean) => void>;
  setRemainingSeconds: React.Dispatch<React.SetStateAction<number>>;
  sound: ReturnType<typeof useApp>['sound'];
  syncScheduledNotification: () => void;
  reportPresence: (isVisible: boolean) => void;
  authService: AuthService;
}

export const useTimerWorker = ({
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
  setRemainingSeconds,
  sound,
  syncScheduledNotification,
  reportPresence,
  authService,
}: UseTimerWorkerParams) => {
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
  }, [
    authService,
    statusRef,
    lastTickWallMsRef,
    targetEndTimeRef,
    handleCompleteRef,
    remainingSecondsRef,
    setRemainingSeconds,
  ]);

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
        saveTimerState(stateToSave, false);
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
  }, [
    sound,
    syncScheduledNotification,
    reportPresence,
    authService,
    statusRef,
    targetEndTimeRef,
    lastTickWallMsRef,
    handleCompleteRef,
    remainingSecondsRef,
    setRemainingSeconds,
    sessionTypeRef,
    currentCycleRef,
    totalSecondsRef,
    timerRunIdRef,
    localUpdatedAtRef,
    activeTagIdRef,
  ]);

  // Main-thread backup countdown timer
  useEffect(() => {
    const backupInterval = setInterval(executeTick, 1000);
    return () => clearInterval(backupInterval);
  }, [executeTick]);
};

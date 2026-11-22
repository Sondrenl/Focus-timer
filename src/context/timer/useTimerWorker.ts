import React, { useCallback, useEffect, useRef } from 'react';
import { SessionType, TimerStatus } from '../../types/timer';
import { wakeLockService } from '../../services/screen/WakeLockService';
import { TAB_ID } from '../../services/timer/TimerBroadcast';
import { formatTime } from '../../utils/formatters';
import { DEVICE_ID, SavedTimerState, saveTimerState } from './timerPersistence';
import { telemetryTracker } from '../services';

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
  keepAwake: boolean;
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
  getServerAlignedNowMs: () => number;
  handleCompleteRef: React.MutableRefObject<(silent?: boolean) => void>;
  shouldDeferExpiredCompletion?: () => boolean;
  onStaleExpiration: () => void;
  setRemainingSeconds: React.Dispatch<React.SetStateAction<number>>;
}

export const useTimerWorker = ({
  status,
  sessionType,
  remainingSeconds,
  keepAwake,
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
  getServerAlignedNowMs,
  handleCompleteRef,
  shouldDeferExpiredCompletion,
  onStaleExpiration,
  setRemainingSeconds,
}: UseTimerWorkerParams) => {
  // Manage screen wake lock: keep screen awake while timer is actively running if keepAwake is enabled
  useEffect(() => {
    if (status === 'RUNNING' && keepAwake) {
      wakeLockService.acquire();
    } else {
      wakeLockService.release();
    }
    return () => {
      wakeLockService.release();
    };
  }, [status, keepAwake]);

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

  // Main countdown tick execution; returns active diffSec if still running, or null if stopped/completed
  const executeTick = useCallback((): number | null => {
    const currentStatus = statusRef.current;
    const nowWall = Date.now();
    lastTickWallMsRef.current = nowWall;

    if (currentStatus !== 'RUNNING' || targetEndTimeRef.current === null) {
      return null;
    }

    const now = getServerAlignedNowMs();
    const target = targetEndTimeRef.current;
    const diffMs = target - now;
    const rawDiffSec = Math.max(0, Math.ceil(diffMs / 1000));
    const maxSec = totalSecondsRef.current > 0 ? totalSecondsRef.current : rawDiffSec;
    const diffSec = Math.min(maxSec, rawDiffSec);

    if (diffSec <= 0) {
      if (diffMs < -900_000) {
        onStaleExpiration();
        return null;
      }
      if (shouldDeferExpiredCompletion && shouldDeferExpiredCompletion()) {
        return 0;
      }
      remainingSecondsRef.current = 0;
      setRemainingSeconds(0);
      const expiredLongAgo = diffMs < -60_000;
      handleCompleteRef.current(expiredLongAgo);
      return null;
    }

    if (diffSec !== remainingSecondsRef.current) {
      remainingSecondsRef.current = diffSec;
      setRemainingSeconds(diffSec);
    }
    return diffSec;
  }, [
    statusRef,
    lastTickWallMsRef,
    targetEndTimeRef,
    totalSecondsRef,
    getServerAlignedNowMs,
    handleCompleteRef,
    shouldDeferExpiredCompletion,
    onStaleExpiration,
    remainingSecondsRef,
    setRemainingSeconds,
  ]);

  // Keep latest executeTick in a ref so the Blob Web Worker and listeners never respawn on settings changes
  const executeTickRef = useRef(executeTick);
  executeTickRef.current = executeTick;

  // Persistent Web Worker initialization (created once per mount)
  useEffect(() => {
    let worker: Worker | null = null;
    let workerUrl: string | null = null;
    let fallbackInterval: ReturnType<typeof setInterval> | null = null;

    try {
      const blob = new Blob([WORKER_SCRIPT], { type: 'application/javascript' });
      workerUrl = URL.createObjectURL(blob);
      worker = new Worker(workerUrl);

      worker.onmessage = (e) => {
        if (e.data === 'TICK') {
          executeTickRef.current();
        }
      };

      worker.postMessage('START');
    } catch {
      if (workerUrl) {
        URL.revokeObjectURL(workerUrl);
        workerUrl = null;
      }
      fallbackInterval = setInterval(() => executeTickRef.current(), 250);
    }

    return () => {
      if (worker) {
        worker.postMessage('STOP');
        worker.terminate();
      }
      if (workerUrl) {
        URL.revokeObjectURL(workerUrl);
      }
      if (fallbackInterval) {
        clearInterval(fallbackInterval);
      }
    };
  }, []);

  // Visibility, pageshow, and focus sync listeners
  useEffect(() => {
    const handleVisibilityOrFocus = (e?: Event) => {
      const isHidden = document.visibilityState === 'hidden';

      if (e?.type === 'visibilitychange' && isHidden) {
        void telemetryTracker.onTabVisibilityChanged(true);
      }

      if (statusRef.current === 'RUNNING' && targetEndTimeRef.current !== null) {
        const diffSec = executeTickRef.current();
        if (diffSec === null) return;

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
        saveTimerState(stateToSave);
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
    statusRef,
    targetEndTimeRef,
    sessionTypeRef,
    currentCycleRef,
    totalSecondsRef,
    timerRunIdRef,
    localUpdatedAtRef,
    activeTagIdRef,
  ]);

  // Main-thread backup countdown timer
  useEffect(() => {
    const backupInterval = setInterval(() => executeTickRef.current(), 1000);
    return () => clearInterval(backupInterval);
  }, []);
};

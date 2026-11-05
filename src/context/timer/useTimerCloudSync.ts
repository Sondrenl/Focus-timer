import React, { useCallback, useEffect, useRef } from 'react';
import { SessionType, TimerStatus, RemoteTimerState, PeerPresence } from '../../types/timer';
import { UserSettings } from '../../types/settings';
import type { useApp } from '../AppContext';
import { AuthService } from '../../services/auth/AuthService';
import { broadcastTimerState } from '../../services/timer/TimerBroadcast';
import { wakeLockService } from '../../services/screen/WakeLockService';
import { useConvexTimer } from '../../services/convex/useConvexTimer';
import { IS_MOBILE } from './timerPersistence';

interface UseTimerCloudSyncParams {
  isAuthenticated: boolean;
  isAuthenticatedRef: React.MutableRefObject<boolean>;
  sessionTypeRef: React.MutableRefObject<SessionType>;
  statusRef: React.MutableRefObject<TimerStatus>;
  currentCycleRef: React.MutableRefObject<number>;
  totalSecondsRef: React.MutableRefObject<number>;
  remainingSecondsRef: React.MutableRefObject<number>;
  targetEndTimeRef: React.MutableRefObject<number | null>;
  timerRunIdRef: React.MutableRefObject<string | null>;
  localUpdatedAtRef: React.MutableRefObject<number>;
  lastLocalActionWallMsRef: React.MutableRefObject<number>;
  lastTickWallMsRef: React.MutableRefObject<number>;
  prevActiveTagIdRef: React.MutableRefObject<string | null>;
  peerPresenceRef: React.MutableRefObject<PeerPresence>;
  settingsRef: React.MutableRefObject<UserSettings>;
  handleCompleteRef: React.MutableRefObject<(silent?: boolean) => void>;
  setSessionType: React.Dispatch<React.SetStateAction<SessionType>>;
  setStatus: React.Dispatch<React.SetStateAction<TimerStatus>>;
  setCurrentCycle: React.Dispatch<React.SetStateAction<number>>;
  setTotalSeconds: React.Dispatch<React.SetStateAction<number>>;
  setRemainingSeconds: React.Dispatch<React.SetStateAction<number>>;
  setTargetEndTime: React.Dispatch<React.SetStateAction<number | null>>;
  setActiveTagId?: (id: string | null) => void;
  getDurationForType: (type: SessionType) => number;
  dispatchCompletionAlert: (completedSessionType: SessionType, runId?: string | null) => void;
  sound: ReturnType<typeof useApp>['sound'];
  notifications: ReturnType<typeof useApp>['notifications'];
  authService: AuthService;
}

export const useTimerCloudSync = ({
  isAuthenticated,
  isAuthenticatedRef,
  sessionTypeRef,
  statusRef,
  currentCycleRef,
  totalSecondsRef,
  remainingSecondsRef,
  targetEndTimeRef,
  timerRunIdRef,
  localUpdatedAtRef,
  lastLocalActionWallMsRef,
  lastTickWallMsRef,
  prevActiveTagIdRef,
  peerPresenceRef,
  settingsRef,
  handleCompleteRef,
  setSessionType,
  setStatus,
  setCurrentCycle,
  setTotalSeconds,
  setRemainingSeconds,
  setTargetEndTime,
  setActiveTagId,
  getDurationForType,
  dispatchCompletionAlert,
  sound,
  notifications,
  authService,
}: UseTimerCloudSyncParams) => {
  const { isConvexConfigured, remoteTimer, mutations: convexTimerMutations } =
    useConvexTimer(isAuthenticated);
  const convexTimerMutationsRef = useRef(convexTimerMutations);
  convexTimerMutationsRef.current = convexTimerMutations;

  const isInitialMountDoneRef = useRef<boolean>(false);
  const lastReportedPresenceRef = useRef<{
    isMobile: boolean;
    isVisible: boolean;
    time: number;
  } | null>(null);

  // Helper to broadcast and push local timer state changes safely without race conditions
  const publishLocalTimerState = useCallback(
    (payload: RemoteTimerState, isUserAction = false) => {
      localUpdatedAtRef.current = payload.updatedAtMs;
      if (isUserAction) {
        lastLocalActionWallMsRef.current = Date.now();
      }

      broadcastTimerState(payload);

      if (isConvexConfigured && isAuthenticatedRef.current) {
        if (payload.status === 'RUNNING') {
          convexTimerMutationsRef.current
            .startTimer({
              sessionType: payload.sessionType,
              durationSeconds: payload.totalSeconds,
              remainingSeconds: payload.remainingSeconds,
              totalSeconds: payload.totalSeconds,
              currentCycle: payload.currentCycle,
              tagId: payload.activeTagId || undefined,
              timerRunId: payload.timerRunId || `run-${Date.now()}`,
            })
            .catch(console.warn);
        } else if (payload.status === 'PAUSED') {
          convexTimerMutationsRef.current
            .pauseTimer({
              remainingSeconds: payload.remainingSeconds,
              tagId: payload.activeTagId || undefined,
            })
            .catch(console.warn);
        } else if (payload.status === 'IDLE') {
          convexTimerMutationsRef.current
            .resetTimer({
              sessionType: payload.sessionType,
              durationSeconds: payload.totalSeconds,
              currentCycle: payload.currentCycle,
              tagId: payload.activeTagId || undefined,
            })
            .catch(console.warn);
        }
      }
    },
    [isConvexConfigured, localUpdatedAtRef, lastLocalActionWallMsRef, isAuthenticatedRef]
  );

  const reportPresence = useCallback(
    (isVisible: boolean) => {
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
      convexTimerMutationsRef.current
        .updatePresence({
          isMobile: IS_MOBILE,
          isVisible,
        })
        .catch(() => {});
    },
    [isConvexConfigured, isAuthenticatedRef]
  );

  // Mark initial mount hydration complete after first render cycle so initial tag setup doesn't push IDLE over remote timer
  useEffect(() => {
    const timer = setTimeout(() => {
      isInitialMountDoneRef.current = true;
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  // Register device presence eagerly when authenticated so peers detect each other immediately
  useEffect(() => {
    if (isConvexConfigured && isAuthenticated) {
      reportPresence(typeof document !== 'undefined' ? document.visibilityState !== 'hidden' : true);
    }
  }, [isConvexConfigured, isAuthenticated, reportPresence]);

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
        const completedRunId =
          timerRunIdRef.current || remote.timerRunId || `${completedType.toLowerCase()}-${now}`;
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
        const tot =
          remote.totalSeconds && remote.totalSeconds > 0 ? remote.totalSeconds : dur;

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
      dispatchCompletionAlert,
      lastLocalActionWallMsRef,
      localUpdatedAtRef,
      statusRef,
      sessionTypeRef,
      targetEndTimeRef,
      timerRunIdRef,
      currentCycleRef,
      totalSecondsRef,
      remainingSecondsRef,
      prevActiveTagIdRef,
      lastTickWallMsRef,
      settingsRef,
      handleCompleteRef,
      setSessionType,
      setCurrentCycle,
      setTotalSeconds,
      setTargetEndTime,
      setRemainingSeconds,
      setStatus,
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
  }, [remoteTimer, isConvexConfigured, peerPresenceRef, lastLocalActionWallMsRef, localUpdatedAtRef]);

  return {
    publishLocalTimerState,
    reportPresence,
    applyRemoteState,
    isInitialMountDoneRef,
  };
};

import React, { useCallback, useEffect, useRef } from 'react';
import { SessionType, TimerStatus, RemoteTimerState, PeerPresence } from '../../types/timer';
import { UserSettings } from '../../types/settings';
import { CoffeeCup } from '../../types/coffee';
import { NotificationService } from '../../services/notification/NotificationService';
import { broadcastTimerState } from '../../services/timer/TimerBroadcast';
import { wakeLockService } from '../../services/screen/WakeLockService';
import { useConvexTimer } from '../../services/convex/useConvexTimer';
import { IS_MOBILE } from './timerPersistence';
import { getLogicalDayKey, INACTIVITY_THRESHOLD_MS } from '../../utils/newDayCheck';
import { telemetryTracker } from '../services';

interface UseTimerCloudSyncParams {
  isAuthenticated: boolean;
  isConvexAuthAuthenticated?: boolean;
  isConvexAuthLoading?: boolean;
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
  profileRef?: React.MutableRefObject<{ dailyGoalMinutes: number }>;
  coffeeCupsRef?: React.MutableRefObject<CoffeeCup[]>;
  handleCompleteRef: React.MutableRefObject<(silent?: boolean) => void>;
  setSessionType: React.Dispatch<React.SetStateAction<SessionType>>;
  setStatus: React.Dispatch<React.SetStateAction<TimerStatus>>;
  setCurrentCycle: React.Dispatch<React.SetStateAction<number>>;
  setTotalSeconds: React.Dispatch<React.SetStateAction<number>>;
  setRemainingSeconds: React.Dispatch<React.SetStateAction<number>>;
  setTargetEndTime: React.Dispatch<React.SetStateAction<number | null>>;
  setActiveTagId?: (id: string | null, options?: { skipTelemetry?: boolean }) => void;
  getDurationForType: (type: SessionType) => number;
  dispatchCompletionAlert: (completedSessionType: SessionType, runId?: string | null) => void;
  syncScheduledNotification: () => void;
  notifications: NotificationService;
}

export interface ResetTimerOptions {
  onlyIfNotRunning?: boolean;
  expectedTimerRunId?: string;
  expectedUpdatedAtMs?: number;
}

function toRemoteTimerState(raw: {
  sessionType: SessionType;
  status: TimerStatus;
  remainingSeconds: number;
  totalSeconds: number;
  targetEndTime?: number | null;
  currentCycle: number;
  activeTagId?: string | null;
  tagId?: string | null;
  timerRunId?: string | null;
  updatedAtMs: number;
}): RemoteTimerState {
  return {
    sessionType: raw.sessionType,
    status: raw.status,
    remainingSeconds: raw.remainingSeconds,
    totalSeconds: raw.totalSeconds,
    targetEndTime: raw.targetEndTime ?? null,
    currentCycle: raw.currentCycle,
    activeTagId: (raw.activeTagId !== undefined ? raw.activeTagId : raw.tagId) ?? null,
    timerRunId: raw.timerRunId ?? null,
    updatedAtMs: raw.updatedAtMs,
  };
}

export const useTimerCloudSync = ({
  isAuthenticated,
  isConvexAuthAuthenticated = true,
  isConvexAuthLoading = false,
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
  profileRef,
  coffeeCupsRef,
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
  syncScheduledNotification,
  notifications,
}: UseTimerCloudSyncParams) => {
  const isConvexQueryAuthReady =
    !isAuthenticated || !isConvexAuthLoading || Boolean(isConvexAuthAuthenticated);

  const { isConvexConfigured, remoteTimer, mutations: convexTimerMutations } =
    useConvexTimer(isAuthenticated, isConvexQueryAuthReady);
  const convexTimerMutationsRef = useRef(convexTimerMutations);
  convexTimerMutationsRef.current = convexTimerMutations;

  const remoteTimerRef = useRef(remoteTimer);
  remoteTimerRef.current = remoteTimer;

  const hasResolvedRemoteTimerRef = useRef<boolean>(false);
  hasResolvedRemoteTimerRef.current = Boolean(
    isConvexConfigured &&
      isAuthenticated &&
      remoteTimer !== undefined &&
      (remoteTimer !== null || isConvexQueryAuthReady)
  );

  const isInitialMountDoneRef = useRef<boolean>(false);
  const finalizedStaleRunIdsRef = useRef<Set<string>>(new Set());
  const lastReportedPresenceRef = useRef<{
    isMobile: boolean;
    isVisible: boolean;
    time: number;
  } | null>(null);

  // Forward-declared ref so mutation reconciliation callbacks can invoke applyRemoteState
  const applyRemoteStateRef = useRef<(remote: RemoteTimerState) => void>(() => {});

  // Helper to broadcast and push local timer state changes safely without race conditions
  const publishLocalTimerState = useCallback(
    (payload: RemoteTimerState, isUserAction = false, resetOptions?: ResetTimerOptions) => {
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
              onlyIfNotRunning: resetOptions?.onlyIfNotRunning,
              expectedTimerRunId: resetOptions?.expectedTimerRunId,
              expectedUpdatedAtMs: resetOptions?.expectedUpdatedAtMs,
            })
            .then((res: any) => {
              if (
                resetOptions &&
                res &&
                typeof res === 'object' &&
                typeof res.updatedAtMs === 'number' &&
                (res.status === 'RUNNING' ||
                  (resetOptions.expectedUpdatedAtMs !== undefined &&
                    res.updatedAtMs > resetOptions.expectedUpdatedAtMs))
              ) {
                localUpdatedAtRef.current = res.updatedAtMs;
                applyRemoteStateRef.current(toRemoteTimerState(res));
              }
            })
            .catch(console.warn);
        }
      }
    },
    [isConvexConfigured, localUpdatedAtRef, lastLocalActionWallMsRef, isAuthenticatedRef]
  );

  const publishTimerCompletion = useCallback(
    (payload: RemoteTimerState, completedTimerRunId?: string | null) => {
      localUpdatedAtRef.current = payload.updatedAtMs;
      broadcastTimerState(payload);

      if (isConvexConfigured && isAuthenticatedRef.current) {
        convexTimerMutationsRef.current
          .completeTimer({
            completedTimerRunId: completedTimerRunId || undefined,
            nextSessionType: payload.sessionType,
            nextDurationSeconds: payload.totalSeconds,
            nextCurrentCycle: payload.currentCycle,
            autoStartNext: payload.status === 'RUNNING',
            nextTimerRunId: payload.timerRunId || undefined,
            tagId: payload.activeTagId || undefined,
          })
          .then((res: any) => {
            if (res && typeof res === 'object' && typeof res.updatedAtMs === 'number') {
              const diverged =
                (res.status === 'RUNNING' && res.timerRunId !== payload.timerRunId) ||
                (payload.status === 'RUNNING' && res.status !== 'RUNNING');
              if (diverged) {
                if (
                  payload.status === 'RUNNING' &&
                  payload.timerRunId &&
                  res.timerRunId !== payload.timerRunId
                ) {
                  void telemetryTracker.discardInProgressAttempt(payload.timerRunId);
                }
                localUpdatedAtRef.current = res.updatedAtMs;
                applyRemoteStateRef.current(toRemoteTimerState(res));
              }
            }
          })
          .catch(console.warn);
      }
    },
    [isConvexConfigured, localUpdatedAtRef, isAuthenticatedRef]
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
        now - last.time < 40000
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
      const MAX_FUTURE_DRIFT_MS = 10 * 60_000; // Allow up to 10m clock skew before NTP resyncs on wake
      const MAX_PAST_AGE_MS = 7 * 24 * 60 * 60 * 1000; // Max 7 days

      if (
        typeof remote.updatedAtMs !== 'number' ||
        !Number.isFinite(remote.updatedAtMs) ||
        remote.updatedAtMs > nowMs + MAX_FUTURE_DRIFT_MS ||
        remote.updatedAtMs < nowMs - MAX_PAST_AGE_MS
      ) {
        console.warn('[Sync] Rejected remote timer state with abnormal timestamp:', remote.updatedAtMs);
        return;
      }

      const hasRecentLocalAction = nowMs - lastLocalActionWallMsRef.current < 1500;
      const isNewer = remote.updatedAtMs > localUpdatedAtRef.current;

      // Only reject remote state if the user directly clicked a button on THIS device
      // in the last 1.5s AND the remote snapshot is older than that button click.
      if (hasRecentLocalAction && !isNewer) {
        return;
      }

      const now = Date.now();

      // Trigger completion alert when remote signals completion or advances to next interval at end time
      // Never fire alerts if completion happened >60s ago (e.g. waking up from OS Doze/sleep).
      const STALE_ALERT_CUTOFF_MS = 60_000;
      const targetPassedRecently =
        targetEndTimeRef.current !== null &&
        now >= targetEndTimeRef.current - 5000 &&
        now - targetEndTimeRef.current <= STALE_ALERT_CUTOFF_MS;
      const remoteCompletedRecently =
        remote.status === 'COMPLETED' &&
        nowMs - remote.updatedAtMs <= STALE_ALERT_CUTOFF_MS;

      if (
        statusRef.current === 'RUNNING' &&
        (remoteCompletedRecently ||
          (remote.status === 'IDLE' &&
            remote.sessionType !== sessionTypeRef.current &&
            targetPassedRecently))
      ) {
        const completedType = sessionTypeRef.current;
        const completedRunId =
          timerRunIdRef.current || remote.timerRunId || `${completedType.toLowerCase()}-${now}`;
        dispatchCompletionAlert(completedType, completedRunId);
      }

      localUpdatedAtRef.current = Math.max(localUpdatedAtRef.current, remote.updatedAtMs);

      if (remote.status === 'RUNNING' && remote.targetEndTime) {
        const diffMs = remote.targetEndTime - now;
        const rawDiffSec = Math.max(0, Math.ceil(diffMs / 1000));
        const diffSec =
          remote.totalSeconds > 0 ? Math.min(remote.totalSeconds, rawDiffSec) : rawDiffSec;

        if (diffSec > 0) {
          if (settingsRef.current.keepAwake !== false) {
            wakeLockService.acquire();
          }

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
            setActiveTagId(remote.activeTagId, { skipTelemetry: true });
          }

          targetEndTimeRef.current = remote.targetEndTime;
          setTargetEndTime(remote.targetEndTime);
          setRemainingSeconds(diffSec);
          setStatus('RUNNING');
          lastTickWallMsRef.current = Date.now();

          syncScheduledNotification();
        } else {
          if (diffMs < -900000) {
            const dur = getDurationForType(remote.sessionType);
            const cycle = remote.currentCycle || 1;
            const staleRunId = remote.timerRunId || null;

            if (staleRunId && !finalizedStaleRunIdsRef.current.has(staleRunId)) {
              finalizedStaleRunIdsRef.current.add(staleRunId);
              void telemetryTracker.onSessionFinalized({
                attemptId: staleRunId,
                outcome: 'abandoned_stale',
                sessionType: remote.sessionType,
                plannedDurationSeconds: remote.totalSeconds || dur,
                remainingSecondsAtEnd: 0,
                cycleIndex: cycle,
                tagId: remote.activeTagId ?? null,
                settings: settingsRef.current,
                dailyGoalMinutes: profileRef?.current.dailyGoalMinutes ?? 120,
                coffeeCups: coffeeCupsRef?.current ?? [],
                wasStarted: true,
                targetEndTimeMs: remote.targetEndTime,
              });
            }

            sessionTypeRef.current = remote.sessionType;
            currentCycleRef.current = cycle;
            totalSecondsRef.current = dur;
            remainingSecondsRef.current = dur;
            statusRef.current = 'IDLE';
            setSessionType(remote.sessionType);
            setCurrentCycle(cycle);
            setTotalSeconds(dur);
            setRemainingSeconds(dur);
            setStatus('IDLE');
            targetEndTimeRef.current = null;
            setTargetEndTime(null);
            timerRunIdRef.current = null;
            if (remote.activeTagId !== undefined && setActiveTagId) {
              prevActiveTagIdRef.current = remote.activeTagId;
              setActiveTagId(remote.activeTagId, { skipTelemetry: true });
            }
            notifications.cancelScheduledNotification();
            wakeLockService.release();

            // Self-heal: authoritatively reset Convex state only if this exact stale run is still active
            convexTimerMutationsRef.current
              .resetTimer({
                sessionType: remote.sessionType,
                durationSeconds: dur,
                currentCycle: cycle,
                tagId: remote.activeTagId || undefined,
                expectedTimerRunId: remote.timerRunId || undefined,
              })
              .catch(() => {});
            return;
          }

          // Align local refs with the remote running session before invoking completion transition
          sessionTypeRef.current = remote.sessionType;
          currentCycleRef.current = remote.currentCycle || 1;
          totalSecondsRef.current = remote.totalSeconds;
          remainingSecondsRef.current = 0;
          targetEndTimeRef.current = remote.targetEndTime;
          timerRunIdRef.current = remote.timerRunId || null;
          if (remote.activeTagId !== undefined && setActiveTagId) {
            prevActiveTagIdRef.current = remote.activeTagId;
            setActiveTagId(remote.activeTagId, { skipTelemetry: true });
          }

          const expiredLongAgo = diffMs < -60000;
          handleCompleteRef.current(expiredLongAgo);
        }
      } else if (remote.status === 'PAUSED') {
        const PAUSED_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
        const isPausedFromPreviousDay =
          getLogicalDayKey(remote.updatedAtMs) !== getLogicalDayKey(nowMs) &&
          nowMs - remote.updatedAtMs >= INACTIVITY_THRESHOLD_MS;
        const isPausedExpired = nowMs - remote.updatedAtMs > PAUSED_TTL_MS;
        if (isPausedFromPreviousDay || isPausedExpired) {
          const resolvedSessionType: SessionType = isPausedFromPreviousDay
            ? 'WORK'
            : remote.sessionType;
          const resolvedCycle = isPausedFromPreviousDay ? 1 : (remote.currentCycle || 1);
          const dur = getDurationForType(resolvedSessionType);
          const staleRunId = remote.timerRunId || null;

          if (staleRunId && !finalizedStaleRunIdsRef.current.has(staleRunId)) {
            finalizedStaleRunIdsRef.current.add(staleRunId);
            void telemetryTracker.onSessionFinalized({
              attemptId: staleRunId,
              outcome: 'abandoned_stale',
              sessionType: remote.sessionType,
              plannedDurationSeconds: remote.totalSeconds || dur,
              remainingSecondsAtEnd: remote.remainingSeconds,
              cycleIndex: remote.currentCycle || 1,
              tagId: remote.activeTagId ?? null,
              settings: settingsRef.current,
              dailyGoalMinutes: profileRef?.current.dailyGoalMinutes ?? 120,
              coffeeCups: coffeeCupsRef?.current ?? [],
              wasStarted: true,
              targetEndTimeMs: null,
            });
          }

          sessionTypeRef.current = resolvedSessionType;
          currentCycleRef.current = resolvedCycle;
          totalSecondsRef.current = dur;
          remainingSecondsRef.current = dur;
          statusRef.current = 'IDLE';
          setSessionType(resolvedSessionType);
          setCurrentCycle(resolvedCycle);
          setTotalSeconds(dur);
          setRemainingSeconds(dur);
          setStatus('IDLE');
          targetEndTimeRef.current = null;
          setTargetEndTime(null);
          timerRunIdRef.current = null;
          if (remote.activeTagId !== undefined && setActiveTagId) {
            prevActiveTagIdRef.current = remote.activeTagId;
            setActiveTagId(remote.activeTagId, { skipTelemetry: true });
          }
          notifications.cancelScheduledNotification();
          wakeLockService.release();

          publishLocalTimerState(
            {
              sessionType: resolvedSessionType,
              status: 'IDLE',
              remainingSeconds: dur,
              totalSeconds: dur,
              targetEndTime: null,
              currentCycle: resolvedCycle,
              activeTagId: remote.activeTagId ?? null,
              timerRunId: null,
              updatedAtMs: nowMs,
            },
            false,
            {
              onlyIfNotRunning: true,
              expectedUpdatedAtMs: remote.updatedAtMs,
            }
          );
          return;
        }

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
          setActiveTagId(remote.activeTagId, { skipTelemetry: true });
        }

        wakeLockService.release();
        notifications.cancelScheduledNotification();
        targetEndTimeRef.current = null;
        setTargetEndTime(null);
        setRemainingSeconds(remote.remainingSeconds);
        setStatus('PAUSED');
      } else {
        const isFromPreviousDay =
          getLogicalDayKey(remote.updatedAtMs) !== getLogicalDayKey(nowMs);
        const resolvedSessionType = isFromPreviousDay ? 'WORK' : remote.sessionType;
        const resolvedCycle = isFromPreviousDay ? 1 : (remote.currentCycle || 1);
        const nextStatus: TimerStatus =
          isFromPreviousDay || remote.status === 'COMPLETED' ? 'IDLE' : remote.status;
        const dur = isFromPreviousDay
          ? getDurationForType('WORK')
          : remote.remainingSeconds && remote.remainingSeconds > 0
          ? remote.remainingSeconds
          : remote.status === 'COMPLETED' && remote.totalSeconds && remote.totalSeconds > 0
          ? remote.totalSeconds
          : getDurationForType(remote.sessionType);
        const tot = isFromPreviousDay
          ? dur
          : remote.totalSeconds && remote.totalSeconds > 0
          ? remote.totalSeconds
          : dur;

        sessionTypeRef.current = resolvedSessionType;
        currentCycleRef.current = resolvedCycle;
        totalSecondsRef.current = tot;
        remainingSecondsRef.current = dur;
        statusRef.current = nextStatus;
        setSessionType(resolvedSessionType);
        setCurrentCycle(resolvedCycle);
        setTotalSeconds(tot);
        timerRunIdRef.current = remote.timerRunId || null;
        if (remote.activeTagId !== undefined && setActiveTagId) {
          prevActiveTagIdRef.current = remote.activeTagId;
          setActiveTagId(remote.activeTagId, { skipTelemetry: true });
        }

        wakeLockService.release();
        notifications.cancelScheduledNotification();
        targetEndTimeRef.current = null;
        setTargetEndTime(null);
        setRemainingSeconds(dur);
        setStatus(nextStatus);
      }
    },
    [
      setActiveTagId,
      notifications,
      getDurationForType,
      dispatchCompletionAlert,
      syncScheduledNotification,
      publishLocalTimerState,
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
      profileRef,
      coffeeCupsRef,
      handleCompleteRef,
      setSessionType,
      setCurrentCycle,
      setTotalSeconds,
      setTargetEndTime,
      setRemainingSeconds,
      setStatus,
    ]
  );

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
      applyRemoteStateRef.current(toRemoteTimerState(remoteTimer));
    }
  }, [remoteTimer, isConvexConfigured, peerPresenceRef, lastLocalActionWallMsRef, localUpdatedAtRef]);

  // Re-evaluate and re-apply remote timer state on wake, focus, or network recovery if local state diverged
  useEffect(() => {
    if (!isConvexConfigured) return;

    const handleWakeResync = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const latestRemote = remoteTimerRef.current;
      if (!latestRemote) return;

      const now = Date.now();
      const hasRecentLocalAction = now - lastLocalActionWallMsRef.current < 1500;
      if (hasRecentLocalAction) return;

      const isNewer = latestRemote.updatedAtMs > localUpdatedAtRef.current;
      const missedRunningRemote =
        latestRemote.status === 'RUNNING' &&
        (statusRef.current !== 'RUNNING' ||
          (latestRemote.timerRunId ?? null) !== timerRunIdRef.current);

      if (isNewer || missedRunningRemote) {
        applyRemoteStateRef.current(toRemoteTimerState(latestRemote));
      }
    };

    document.addEventListener('visibilitychange', handleWakeResync);
    window.addEventListener('pageshow', handleWakeResync);
    window.addEventListener('focus', handleWakeResync);
    window.addEventListener('online', handleWakeResync);

    return () => {
      document.removeEventListener('visibilitychange', handleWakeResync);
      window.removeEventListener('pageshow', handleWakeResync);
      window.removeEventListener('focus', handleWakeResync);
      window.removeEventListener('online', handleWakeResync);
    };
  }, [isConvexConfigured, lastLocalActionWallMsRef, localUpdatedAtRef, statusRef, timerRunIdRef]);

  return {
    publishLocalTimerState,
    publishTimerCompletion,
    reportPresence,
    applyRemoteState,
    isInitialMountDoneRef,
    hasResolvedRemoteTimerRef,
    remoteTimerRef,
    isConvexConfigured,
  };
};

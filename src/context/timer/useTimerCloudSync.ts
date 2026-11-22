import React, { useCallback, useEffect, useRef } from 'react';
import { SessionType, TimerStatus, RemoteTimerState } from '../../types/timer';
import { UserSettings } from '../../types/settings';
import { CoffeeCup } from '../../types/coffee';
import { broadcastTimerState } from '../../services/timer/TimerBroadcast';
import { wakeLockService } from '../../services/screen/WakeLockService';
import { useConvexTimer } from '../../services/convex/useConvexTimer';
import { getLogicalDayKey, setLastResetDayKey, INACTIVITY_THRESHOLD_MS } from '../../utils/newDayCheck';
import { telemetryTracker } from '../services';

interface CompletedSessionFallback {
  tagId: string | null;
  sessionType: SessionType;
  durationSeconds: number;
  completedAt: string;
  timerRunId?: string | null;
}

interface UseTimerCloudSyncParams {
  isAuthenticated: boolean;
  isConvexAuthReady?: boolean;
  isConvexConnected?: boolean;
  isConvexConnectedRef?: React.MutableRefObject<boolean>;
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
  activeTagIdRef: React.MutableRefObject<string | null>;
  prevActiveTagIdRef: React.MutableRefObject<string | null>;
  serverClockOffsetMsRef: React.MutableRefObject<number>;
  getServerAlignedNowMs: () => number;
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
  clearAlertClaim?: (runId?: string | null) => void;
  recordSessionFallback?: (session: CompletedSessionFallback) => Promise<unknown>;
  triggerCompletionConfetti?: () => void;
}

export interface ResetTimerOptions {
  onlyIfNotRunning?: boolean;
  onlyIfIdle?: boolean;
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
  lastCompletedTimerRunId?: string | null;
  serverAutoStartStreak?: number;
  updatedAtMs: number;
  serverNowMs?: number;
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
    lastCompletedTimerRunId: raw.lastCompletedTimerRunId ?? null,
    serverAutoStartStreak: raw.serverAutoStartStreak,
    updatedAtMs: raw.updatedAtMs,
    serverNowMs: raw.serverNowMs,
  };
}

export const useTimerCloudSync = ({
  isAuthenticated,
  isConvexAuthReady = isAuthenticated,
  isConvexConnected = true,
  isConvexConnectedRef,
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
  activeTagIdRef,
  prevActiveTagIdRef,
  serverClockOffsetMsRef,
  getServerAlignedNowMs,
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
  clearAlertClaim,
  recordSessionFallback,
  triggerCompletionConfetti,
}: UseTimerCloudSyncParams) => {
  const isConvexQueryAuthReady = !isAuthenticated || Boolean(isConvexAuthReady);

  const { isConvexConfigured, remoteTimer, mutations: convexTimerMutations } =
    useConvexTimer(isAuthenticated, isConvexQueryAuthReady);
  const convexTimerMutationsRef = useRef(convexTimerMutations);
  convexTimerMutationsRef.current = convexTimerMutations;

  const remoteTimerRef = useRef(remoteTimer);
  remoteTimerRef.current = remoteTimer;

  const hasResolvedRemoteTimer = Boolean(
    isConvexConfigured &&
      isAuthenticated &&
      isConvexQueryAuthReady &&
      remoteTimer !== undefined
  );
  const hasResolvedRemoteTimerRef = useRef<boolean>(false);
  hasResolvedRemoteTimerRef.current = hasResolvedRemoteTimer;

  const isInitialMountDoneRef = useRef<boolean>(false);
  const hasReconciledSignInRef = useRef<boolean>(false);
  const prevConnectedRef = useRef<boolean>(isConvexConnected);
  const finalizedStaleRunIdsRef = useRef<Set<string>>(new Set());
  const acknowledgedRunIdsRef = useRef<Set<string>>(new Set());

  const isOnlineAndConnected = useCallback((): boolean => {
    if (!isConvexConfigured || !isAuthenticatedRef.current) return false;
    if (isConvexConnectedRef && !isConvexConnectedRef.current) return false;
    return true;
  }, [isConvexConfigured, isAuthenticatedRef, isConvexConnectedRef]);

  const recordServerClockSample = useCallback(
    (serverNowMs?: number) => {
      if (typeof serverNowMs !== 'number' || !Number.isFinite(serverNowMs)) return;
      const rawOffset = serverNowMs - Date.now();
      if (Math.abs(rawOffset) > 12 * 60 * 60 * 1000) return;
      const prev = serverClockOffsetMsRef.current;
      if (prev === 0 || Math.abs(rawOffset - prev) > 2000) {
        serverClockOffsetMsRef.current = rawOffset;
      } else {
        serverClockOffsetMsRef.current = Math.round(prev * 0.7 + rawOffset * 0.3);
      }
    },
    [serverClockOffsetMsRef]
  );

  // Reset clock offset and reconciliation refs when signed out
  useEffect(() => {
    if (!isAuthenticated) {
      serverClockOffsetMsRef.current = 0;
      hasReconciledSignInRef.current = false;
      acknowledgedRunIdsRef.current.clear();
    }
  }, [isAuthenticated, serverClockOffsetMsRef]);

  // Forward-declared ref so mutation reconciliation callbacks can invoke applyRemoteState
  const applyRemoteStateRef = useRef<(remote: RemoteTimerState, forceApply?: boolean) => void>(
    () => {}
  );

  // Helper to broadcast and push local timer state changes safely without race conditions
  const publishLocalTimerState = useCallback(
    (payload: RemoteTimerState, isUserAction = false, resetOptions?: ResetTimerOptions) => {
      localUpdatedAtRef.current = Math.max(localUpdatedAtRef.current, payload.updatedAtMs);
      if (isUserAction) {
        lastLocalActionWallMsRef.current = Date.now();
      }
      const dispatchActionWallMs = lastLocalActionWallMsRef.current;

      broadcastTimerState(payload);

      // Do not enqueue stale timer mutations into Convex RAM while offline; on reconnect we reconcile
      // against live server state so offline taps never overwrite an active session on another device.
      if (isOnlineAndConnected()) {
        if (payload.status === 'RUNNING') {
          convexTimerMutationsRef.current
            .startTimer({
              sessionType: payload.sessionType,
              durationSeconds: Math.max(1, Math.round(payload.totalSeconds)),
              remainingSeconds: Math.max(1, Math.round(payload.remainingSeconds)),
              totalSeconds: Math.max(1, Math.round(payload.totalSeconds)),
              currentCycle: Math.max(1, Math.round(payload.currentCycle)),
              tagId: payload.activeTagId || undefined,
              timerRunId: payload.timerRunId || `run-${Date.now()}`,
              clientActionAtMs: payload.updatedAtMs,
              clientTargetEndTimeMs: payload.targetEndTime ?? undefined,
            })
            .then((res: any) => {
              if (res && typeof res === 'object') {
                recordServerClockSample(res.serverNowMs);
                if (
                  res.applied === false &&
                  typeof res.updatedAtMs === 'number' &&
                  lastLocalActionWallMsRef.current === dispatchActionWallMs
                ) {
                  localUpdatedAtRef.current = res.updatedAtMs;
                  applyRemoteStateRef.current(toRemoteTimerState(res), true);
                } else if (typeof res.updatedAtMs === 'number') {
                  localUpdatedAtRef.current = Math.max(localUpdatedAtRef.current, res.updatedAtMs);
                }
              }
            })
            .catch(console.warn);
        } else if (payload.status === 'PAUSED') {
          convexTimerMutationsRef.current
            .pauseTimer({
              remainingSeconds: Math.max(0, Math.round(payload.remainingSeconds)),
              tagId: payload.activeTagId || undefined,
              expectedTimerRunId: payload.timerRunId || undefined,
            })
            .then((res: any) => {
              if (res && typeof res === 'object') {
                recordServerClockSample(res.serverNowMs);
                if (
                  res.applied === false &&
                  typeof res.updatedAtMs === 'number' &&
                  lastLocalActionWallMsRef.current === dispatchActionWallMs
                ) {
                  localUpdatedAtRef.current = res.updatedAtMs;
                  applyRemoteStateRef.current(toRemoteTimerState(res), true);
                } else if (typeof res.updatedAtMs === 'number') {
                  localUpdatedAtRef.current = Math.max(localUpdatedAtRef.current, res.updatedAtMs);
                }
              }
            })
            .catch(console.warn);
        } else if (payload.status === 'IDLE') {
          convexTimerMutationsRef.current
            .resetTimer({
              sessionType: payload.sessionType,
              durationSeconds: Math.max(1, Math.round(payload.totalSeconds)),
              currentCycle: Math.max(1, Math.round(payload.currentCycle)),
              tagId: payload.activeTagId || undefined,
              onlyIfNotRunning: resetOptions?.onlyIfNotRunning,
              onlyIfIdle: resetOptions?.onlyIfIdle,
              expectedTimerRunId: resetOptions?.expectedTimerRunId,
              expectedUpdatedAtMs: resetOptions?.expectedUpdatedAtMs,
              clientActionAtMs: payload.updatedAtMs,
            })
            .then((res: any) => {
              if (res && typeof res === 'object') {
                recordServerClockSample(res.serverNowMs);
                if (
                  res.applied === false &&
                  typeof res.updatedAtMs === 'number' &&
                  lastLocalActionWallMsRef.current === dispatchActionWallMs
                ) {
                  localUpdatedAtRef.current = res.updatedAtMs;
                  applyRemoteStateRef.current(toRemoteTimerState(res), true);
                } else if (typeof res.updatedAtMs === 'number') {
                  localUpdatedAtRef.current = Math.max(localUpdatedAtRef.current, res.updatedAtMs);
                }
              }
            })
            .catch(console.warn);
        }
      }
    },
    [
      isOnlineAndConnected,
      localUpdatedAtRef,
      lastLocalActionWallMsRef,
      recordServerClockSample,
    ]
  );

  // Dedicated tag-update publisher: patches only tagId without resetting targetEndTime or resurrecting timers
  const publishTagUpdate = useCallback(
    (nextTagId: string | null) => {
      const nowAligned = getServerAlignedNowMs();
      localUpdatedAtRef.current = Math.max(localUpdatedAtRef.current, nowAligned);
      lastLocalActionWallMsRef.current = Date.now();

      const currentStatus = statusRef.current;
      broadcastTimerState({
        sessionType: sessionTypeRef.current,
        status: currentStatus,
        remainingSeconds: remainingSecondsRef.current,
        totalSeconds: totalSecondsRef.current,
        targetEndTime: targetEndTimeRef.current,
        currentCycle: currentCycleRef.current,
        activeTagId: nextTagId,
        timerRunId: timerRunIdRef.current,
        updatedAtMs: nowAligned,
      });

      if (isOnlineAndConnected() && currentStatus !== 'COMPLETED') {
        convexTimerMutationsRef.current
          .updateTag({
            tagId: nextTagId || undefined,
            expectedStatus: currentStatus,
            expectedTimerRunId:
              currentStatus === 'RUNNING' || currentStatus === 'PAUSED'
                ? timerRunIdRef.current || undefined
                : undefined,
          })
          .then((res: any) => {
            if (res && typeof res === 'object') {
              recordServerClockSample(res.serverNowMs);
              if (typeof res.updatedAtMs === 'number') {
                localUpdatedAtRef.current = Math.max(localUpdatedAtRef.current, res.updatedAtMs);
              }
            }
          })
          .catch(console.warn);
      }
    },
    [
      isOnlineAndConnected,
      getServerAlignedNowMs,
      localUpdatedAtRef,
      lastLocalActionWallMsRef,
      statusRef,
      sessionTypeRef,
      remainingSecondsRef,
      totalSecondsRef,
      targetEndTimeRef,
      currentCycleRef,
      timerRunIdRef,
      recordServerClockSample,
    ]
  );

  const publishTimerCompletion = useCallback(
    (
      payload: RemoteTimerState,
      completedTimerRunId?: string | null,
      completedSessionFallback?: CompletedSessionFallback
    ) => {
      localUpdatedAtRef.current = Math.max(localUpdatedAtRef.current, payload.updatedAtMs);
      // Protect optimistic completion transition from briefly flickering against an in-flight server IDLE echo
      lastLocalActionWallMsRef.current = Date.now();
      const dispatchActionWallMs = lastLocalActionWallMsRef.current;
      broadcastTimerState(payload);

      if (!isOnlineAndConnected()) {
        // Signed-out or offline: record locally (and enqueue in offline outbox if signed in)
        if (completedSessionFallback && recordSessionFallback) {
          void recordSessionFallback(completedSessionFallback);
        }
        return;
      }

      convexTimerMutationsRef.current
        .completeTimer({
          completedTimerRunId: completedTimerRunId || undefined,
          nextSessionType: payload.sessionType,
          nextDurationSeconds: Math.max(1, Math.round(payload.totalSeconds)),
          nextCurrentCycle: Math.max(1, Math.round(payload.currentCycle)),
          autoStartNext: payload.status === 'RUNNING',
          nextTimerRunId: payload.timerRunId || undefined,
          tagId: payload.activeTagId || undefined,
        })
        .then((res: any) => {
          if (res === null) {
            // No active_timers row existed on Convex yet (e.g. started locally before sign-in):
            // record the completed session via fallback and start next interval if auto-started.
            if (completedSessionFallback && recordSessionFallback) {
              void recordSessionFallback(completedSessionFallback);
            }
            if (payload.status === 'RUNNING') {
              publishLocalTimerState(payload, false);
            }
            return;
          }

          if (res && typeof res === 'object') {
            recordServerClockSample(res.serverNowMs);

            if (typeof res.updatedAtMs === 'number') {
              // If the server rejected completion as too_early (positive client clock skew),
              // release the premature alert claim, discard any auto-started next attempt,
              // do NOT record a phantom session, and adopt the still-RUNNING server row.
              if (res.rejectedReason === 'too_early') {
                clearAlertClaim?.(completedTimerRunId);
                if (payload.status === 'RUNNING' && payload.timerRunId) {
                  void telemetryTracker.discardInProgressAttempt(payload.timerRunId);
                }
                if (lastLocalActionWallMsRef.current === dispatchActionWallMs) {
                  localUpdatedAtRef.current = res.updatedAtMs;
                  applyRemoteStateRef.current(toRemoteTimerState(res), true);
                }
                return;
              }

              const diverged =
                res.status !== payload.status ||
                res.sessionType !== payload.sessionType ||
                res.currentCycle !== payload.currentCycle ||
                (res.timerRunId ?? null) !== (payload.timerRunId ?? null);
              if (diverged) {
                if (
                  payload.status === 'RUNNING' &&
                  payload.timerRunId &&
                  res.timerRunId !== payload.timerRunId
                ) {
                  void telemetryTracker.discardInProgressAttempt(payload.timerRunId);
                }
                if (lastLocalActionWallMsRef.current === dispatchActionWallMs) {
                  localUpdatedAtRef.current = res.updatedAtMs;
                  applyRemoteStateRef.current(toRemoteTimerState(res), true);
                }
              } else {
                localUpdatedAtRef.current = Math.max(localUpdatedAtRef.current, res.updatedAtMs);
              }
            }
          }
        })
        .catch((err) => {
          console.warn('Convex completeTimer failed, falling back to local session recording:', err);
          if (lastLocalActionWallMsRef.current === dispatchActionWallMs) {
            lastLocalActionWallMsRef.current = 0;
          }
          if (completedSessionFallback && recordSessionFallback) {
            void recordSessionFallback(completedSessionFallback);
          }
        });
    },
    [
      isOnlineAndConnected,
      localUpdatedAtRef,
      lastLocalActionWallMsRef,
      recordServerClockSample,
      clearAlertClaim,
      recordSessionFallback,
      publishLocalTimerState,
    ]
  );

  // Mark initial mount hydration complete after first render cycle so initial tag setup doesn't push IDLE over remote timer
  useEffect(() => {
    const timer = setTimeout(() => {
      isInitialMountDoneRef.current = true;
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  // Release screen wake lock when the browser tab or app is closed
  useEffect(() => {
    const handlePageHide = () => {
      wakeLockService.release();
    };

    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, []);

  // Method to apply authoritative remote timer state
  const applyRemoteState = useCallback(
    (remote: RemoteTimerState, forceApply = false) => {
      const wallNowMs = Date.now();
      const nowMs = getServerAlignedNowMs();
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

      if (forceApply) {
        lastLocalActionWallMsRef.current = 0;
      } else {
        const hasRecentLocalAction = wallNowMs - lastLocalActionWallMsRef.current < 1500;
        const isNewer = remote.updatedAtMs > localUpdatedAtRef.current;

        // Only reject remote state if the user directly clicked a button on THIS device
        // in the last 1.5s AND the remote snapshot is not newer than our aligned local timestamp.
        if (hasRecentLocalAction && !isNewer) {
          return;
        }
      }

      const now = getServerAlignedNowMs();

      // Trigger completion alert when remote signals completion or advances to next interval at end time.
      // Evaluate against server-aligned clock so lagging device clocks never drop alerts.
      const STALE_ALERT_CUTOFF_MS = 60_000;
      const targetNearOrJustPassed =
        targetEndTimeRef.current !== null &&
        targetEndTimeRef.current - now <= 15_000 &&
        now - targetEndTimeRef.current <= STALE_ALERT_CUTOFF_MS;
      const remoteUpdatedRecently =
        Math.abs(now - remote.updatedAtMs) <= STALE_ALERT_CUTOFF_MS;
      const remoteCompletedRecently =
        remote.status === 'COMPLETED' && remoteUpdatedRecently;
      const remoteCompletedToIdle =
        remote.status === 'IDLE' &&
        (remote.sessionType !== sessionTypeRef.current ||
          (Boolean(timerRunIdRef.current) &&
            remote.lastCompletedTimerRunId === timerRunIdRef.current)) &&
        targetNearOrJustPassed &&
        remoteUpdatedRecently;
      const remoteAutoStartedNextInterval =
        remote.status === 'RUNNING' &&
        Boolean(remote.timerRunId) &&
        remote.timerRunId !== timerRunIdRef.current &&
        (remote.sessionType !== sessionTypeRef.current ||
          (Boolean(timerRunIdRef.current) &&
            remote.lastCompletedTimerRunId === timerRunIdRef.current)) &&
        targetNearOrJustPassed &&
        remoteUpdatedRecently;

      const prevRunId = timerRunIdRef.current;
      const prevSessionType = sessionTypeRef.current;
      const prevTotalSeconds = totalSecondsRef.current;
      const prevCycle = currentCycleRef.current;
      const prevTargetEnd = targetEndTimeRef.current;
      const prevTagId = activeTagIdRef.current;

      if (
        statusRef.current === 'RUNNING' &&
        (remoteCompletedRecently || remoteCompletedToIdle || remoteAutoStartedNextInterval)
      ) {
        const completedRunId = remoteAutoStartedNextInterval
          ? prevRunId || `${prevSessionType.toLowerCase()}-${now}`
          : prevRunId || remote.timerRunId || `${prevSessionType.toLowerCase()}-${now}`;
        dispatchCompletionAlert(prevSessionType, completedRunId);
        if (
          triggerCompletionConfetti &&
          (typeof document === 'undefined' || document.visibilityState === 'visible')
        ) {
          triggerCompletionConfetti();
        }
        // Finalize any local in-memory telemetry draft so it never leaks as abandoned_stale later
        if (prevRunId) {
          void telemetryTracker.onSessionFinalized({
            attemptId: prevRunId,
            outcome: 'completed',
            sessionType: prevSessionType,
            plannedDurationSeconds: prevTotalSeconds,
            remainingSecondsAtEnd: 0,
            cycleIndex: prevCycle,
            tagId: prevTagId,
            settings: settingsRef.current,
            dailyGoalMinutes: profileRef?.current.dailyGoalMinutes ?? 120,
            coffeeCups: coffeeCupsRef?.current ?? [],
            wasStarted: true,
            targetEndTimeMs: prevTargetEnd,
          });
        }
      } else if (
        prevRunId &&
        (remote.status === 'IDLE' ||
          remote.status !== statusRef.current ||
          (remote.timerRunId && remote.timerRunId !== prevRunId))
      ) {
        // Another tab/device paused, resumed, switched, or stopped the run — invalidate stale cached draft
        telemetryTracker.invalidateDraftCache();
      }

      localUpdatedAtRef.current = forceApply
        ? remote.updatedAtMs
        : Math.max(localUpdatedAtRef.current, remote.updatedAtMs);

      if (remote.status === 'RUNNING' && remote.targetEndTime) {
        const diffMs = remote.targetEndTime - now;
        const rawDiffSec = Math.max(0, Math.ceil(diffMs / 1000));
        const diffSec =
          remote.totalSeconds > 0 ? Math.min(remote.totalSeconds, rawDiffSec) : rawDiffSec;

        if (diffSec > 0) {
          if (settingsRef.current.keepAwake !== false) {
            void wakeLockService.acquire();
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
            activeTagIdRef.current = remote.activeTagId;
            prevActiveTagIdRef.current = remote.activeTagId;
            setActiveTagId(remote.activeTagId, { skipTelemetry: true });
          }

          targetEndTimeRef.current = remote.targetEndTime;
          setTargetEndTime(remote.targetEndTime);
          setRemainingSeconds(diffSec);
          setStatus('RUNNING');
          lastTickWallMsRef.current = Date.now();
        } else {
          if (diffMs < -900000) {
            const isFromPreviousDay =
              getLogicalDayKey(remote.targetEndTime) !== getLogicalDayKey(now) &&
              now - remote.targetEndTime >= INACTIVITY_THRESHOLD_MS;
            const resolvedSessionType: SessionType = isFromPreviousDay
              ? 'WORK'
              : remote.sessionType;
            const resolvedCycle = isFromPreviousDay ? 1 : (remote.currentCycle || 1);
            const dur = getDurationForType(resolvedSessionType);
            const staleRunId = remote.timerRunId || null;

            if (staleRunId && !finalizedStaleRunIdsRef.current.has(staleRunId)) {
              finalizedStaleRunIdsRef.current.add(staleRunId);
              void telemetryTracker.onSessionFinalized({
                attemptId: staleRunId,
                outcome: 'abandoned_stale',
                sessionType: remote.sessionType,
                plannedDurationSeconds: remote.totalSeconds || dur,
                remainingSecondsAtEnd: 0,
                cycleIndex: remote.currentCycle || 1,
                tagId: remote.activeTagId ?? null,
                settings: settingsRef.current,
                dailyGoalMinutes: profileRef?.current.dailyGoalMinutes ?? 120,
                coffeeCups: coffeeCupsRef?.current ?? [],
                wasStarted: true,
                targetEndTimeMs: remote.targetEndTime,
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
              activeTagIdRef.current = remote.activeTagId;
              prevActiveTagIdRef.current = remote.activeTagId;
              setActiveTagId(remote.activeTagId, { skipTelemetry: true });
            }
            void wakeLockService.release();

            if (isFromPreviousDay) {
              setLastResetDayKey(getLogicalDayKey(wallNowMs));
            }

            // Self-heal: authoritatively reset Convex state only when signed in & connected
            if (isOnlineAndConnected()) {
              convexTimerMutationsRef.current
                .resetTimer({
                  sessionType: resolvedSessionType,
                  durationSeconds: dur,
                  currentCycle: resolvedCycle,
                  tagId: remote.activeTagId || undefined,
                  ...(remote.timerRunId
                    ? { expectedTimerRunId: remote.timerRunId }
                    : { onlyIfNotRunning: true, expectedUpdatedAtMs: remote.updatedAtMs }),
                })
                .catch(() => {});
            }
            return;
          }

          // Align local refs (including activeTagIdRef synchronously!) before invoking completion transition
          sessionTypeRef.current = remote.sessionType;
          currentCycleRef.current = remote.currentCycle || 1;
          totalSecondsRef.current = remote.totalSeconds;
          remainingSecondsRef.current = 0;
          targetEndTimeRef.current = remote.targetEndTime;
          timerRunIdRef.current = remote.timerRunId || null;
          if (remote.activeTagId !== undefined && setActiveTagId) {
            activeTagIdRef.current = remote.activeTagId;
            prevActiveTagIdRef.current = remote.activeTagId;
            setActiveTagId(remote.activeTagId, { skipTelemetry: true });
          }

          const expiredLongAgo = diffMs < -60000;
          handleCompleteRef.current(expiredLongAgo);
        }
      } else if (remote.status === 'PAUSED') {
        const PAUSED_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
        const isPausedFromPreviousDay =
          getLogicalDayKey(remote.updatedAtMs) !== getLogicalDayKey(wallNowMs) &&
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
            activeTagIdRef.current = remote.activeTagId;
            prevActiveTagIdRef.current = remote.activeTagId;
            setActiveTagId(remote.activeTagId, { skipTelemetry: true });
          }
          void wakeLockService.release();

          if (isPausedFromPreviousDay) {
            setLastResetDayKey(getLogicalDayKey(wallNowMs));
          }

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

        const clampedPausedRemaining =
          remote.totalSeconds > 0
            ? Math.min(remote.totalSeconds, Math.max(0, remote.remainingSeconds))
            : Math.max(0, remote.remainingSeconds);

        sessionTypeRef.current = remote.sessionType;
        currentCycleRef.current = remote.currentCycle || 1;
        totalSecondsRef.current = remote.totalSeconds;
        remainingSecondsRef.current = clampedPausedRemaining;
        statusRef.current = 'PAUSED';
        setSessionType(remote.sessionType);
        setCurrentCycle(remote.currentCycle || 1);
        setTotalSeconds(remote.totalSeconds);
        timerRunIdRef.current = remote.timerRunId || null;
        if (remote.activeTagId !== undefined && setActiveTagId) {
          activeTagIdRef.current = remote.activeTagId;
          prevActiveTagIdRef.current = remote.activeTagId;
          setActiveTagId(remote.activeTagId, { skipTelemetry: true });
        }

        void wakeLockService.release();
        targetEndTimeRef.current = null;
        setTargetEndTime(null);
        setRemainingSeconds(clampedPausedRemaining);
        setStatus('PAUSED');
      } else {
        const isFromPreviousDay =
          getLogicalDayKey(remote.updatedAtMs) !== getLogicalDayKey(wallNowMs) &&
          nowMs - remote.updatedAtMs >= INACTIVITY_THRESHOLD_MS;
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
          activeTagIdRef.current = remote.activeTagId;
          prevActiveTagIdRef.current = remote.activeTagId;
          setActiveTagId(remote.activeTagId, { skipTelemetry: true });
        }

        void wakeLockService.release();
        targetEndTimeRef.current = null;
        setTargetEndTime(null);
        setRemainingSeconds(dur);
        setStatus(nextStatus);

        // Persist new-day reset back to Convex so active_timers doesn't remain stuck on yesterday forever
        if (isFromPreviousDay) {
          setLastResetDayKey(getLogicalDayKey(wallNowMs));
          const needsConvexReset =
            remote.sessionType !== 'WORK' ||
            (remote.currentCycle || 1) !== 1 ||
            remote.remainingSeconds !== dur ||
            remote.totalSeconds !== dur;
          if (needsConvexReset) {
            publishLocalTimerState(
              {
                sessionType: 'WORK',
                status: 'IDLE',
                remainingSeconds: dur,
                totalSeconds: dur,
                targetEndTime: null,
                currentCycle: 1,
                activeTagId: remote.activeTagId ?? null,
                timerRunId: null,
                updatedAtMs: nowMs,
              },
              false,
              {
                onlyIfIdle: true,
                expectedUpdatedAtMs: remote.updatedAtMs,
              }
            );
          }
        }
      }
    },
    [
      isOnlineAndConnected,
      getServerAlignedNowMs,
      setActiveTagId,
      getDurationForType,
      dispatchCompletionAlert,
      triggerCompletionConfetti,
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
      activeTagIdRef,
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

  // Promote a locally running timer to Convex on sign-in or reconnect when the server has no active timer
  // (null or an older IDLE row), so signing in mid-Pomodoro never kills an active focus session.
  const promoteLocalActiveTimerIfNewer = useCallback(
    (remote: typeof remoteTimer) => {
      if (!isOnlineAndConnected()) return false;
      const localStatus = statusRef.current;
      if (localStatus !== 'RUNNING') return false;

      const nowAligned = getServerAlignedNowMs();
      const targetEnd = targetEndTimeRef.current;
      if (!targetEnd || targetEnd <= nowAligned) return false;

      const remoteIsEmptyOrOlderIdle =
        remote === null ||
        (remote !== undefined &&
          remote.status === 'IDLE' &&
          localUpdatedAtRef.current > remote.updatedAtMs);

      if (!remoteIsEmptyOrOlderIdle) return false;

      const remainingSec = Math.max(
        1,
        Math.min(totalSecondsRef.current, Math.ceil((targetEnd - nowAligned) / 1000))
      );
      publishLocalTimerState(
        {
          sessionType: sessionTypeRef.current,
          status: 'RUNNING',
          remainingSeconds: remainingSec,
          totalSeconds: totalSecondsRef.current,
          targetEndTime: targetEnd,
          currentCycle: currentCycleRef.current,
          activeTagId: activeTagIdRef.current,
          timerRunId: timerRunIdRef.current || `run-${nowAligned}`,
          updatedAtMs: Math.max(localUpdatedAtRef.current, nowAligned),
        },
        false
      );
      return true;
    },
    [
      isOnlineAndConnected,
      statusRef,
      targetEndTimeRef,
      totalSecondsRef,
      sessionTypeRef,
      currentCycleRef,
      activeTagIdRef,
      timerRunIdRef,
      localUpdatedAtRef,
      getServerAlignedNowMs,
      publishLocalTimerState,
    ]
  );

  // Adopt live Convex WebSocket timer updates (never reading cached serverNowMs from query)
  useEffect(() => {
    if (!isConvexConfigured || !hasResolvedRemoteTimer) return;

    if (!hasReconciledSignInRef.current) {
      hasReconciledSignInRef.current = true;
      if (promoteLocalActiveTimerIfNewer(remoteTimer)) {
        return;
      }
    }

    if (!remoteTimer) return;

    const wallNow = Date.now();
    const hasRecentLocalAction = wallNow - lastLocalActionWallMsRef.current < 1500;
    const isNewer = remoteTimer.updatedAtMs > localUpdatedAtRef.current;

    // Adopt remote state unconditionally if no recent local action on this device,
    // or if the remote state timestamp is strictly newer than our aligned local state.
    if (!hasRecentLocalAction || isNewer) {
      applyRemoteStateRef.current(toRemoteTimerState(remoteTimer));
    }

    // Acknowledge live client presence for server-auto-started intervals so autoStartPomodoros
    // continues seamlessly instead of halting after MAX_UNATTENDED_SERVER_AUTO_STARTS.
    if (
      remoteTimer.status === 'RUNNING' &&
      remoteTimer.timerRunId &&
      (remoteTimer.serverAutoStartStreak ?? 0) > 0 &&
      isOnlineAndConnected() &&
      !acknowledgedRunIdsRef.current.has(remoteTimer.timerRunId) &&
      (typeof document === 'undefined' || document.visibilityState === 'visible')
    ) {
      const runId = remoteTimer.timerRunId;
      acknowledgedRunIdsRef.current.add(runId);
      convexTimerMutationsRef.current
        .acknowledgeActive({ timerRunId: runId })
        .then((res: any) => {
          if (res && typeof res === 'object') {
            recordServerClockSample(res.serverNowMs);
          }
        })
        .catch(() => {
          acknowledgedRunIdsRef.current.delete(runId);
        });
    }
  }, [
    remoteTimer,
    hasResolvedRemoteTimer,
    isConvexConfigured,
    lastLocalActionWallMsRef,
    localUpdatedAtRef,
    promoteLocalActiveTimerIfNewer,
    isOnlineAndConnected,
    recordServerClockSample,
  ]);

  // Reconcile on WebSocket disconnect -> reconnect transition
  useEffect(() => {
    const wasConnected = prevConnectedRef.current;
    prevConnectedRef.current = isConvexConnected;
    if (!wasConnected && isConvexConnected && hasResolvedRemoteTimer) {
      const latestRemote = remoteTimerRef.current;
      if (!promoteLocalActiveTimerIfNewer(latestRemote) && latestRemote) {
        applyRemoteStateRef.current(toRemoteTimerState(latestRemote));
      }
    }
  }, [isConvexConnected, hasResolvedRemoteTimer, promoteLocalActiveTimerIfNewer]);

  // Re-evaluate and re-apply remote timer state on wake, focus, or network recovery if local state diverged
  useEffect(() => {
    if (!isConvexConfigured) return;

    const handleWakeResync = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const latestRemote = remoteTimerRef.current;
      if (!latestRemote) return;

      const wallNow = Date.now();
      const hasRecentLocalAction = wallNow - lastLocalActionWallMsRef.current < 1500;
      if (hasRecentLocalAction) return;

      const nowAligned = getServerAlignedNowMs();
      const isNewer = latestRemote.updatedAtMs > localUpdatedAtRef.current;
      const isSameTimestampOrUnhydrated =
        localUpdatedAtRef.current === 0 || latestRemote.updatedAtMs >= localUpdatedAtRef.current;
      const isStillActiveRemote =
        latestRemote.status === 'RUNNING' &&
        typeof latestRemote.targetEndTime === 'number' &&
        latestRemote.targetEndTime > nowAligned;
      // Never revert a newer local offline Pause/Reset/Skip back to an older RUNNING snapshot
      const missedRunningRemote =
        isStillActiveRemote &&
        isSameTimestampOrUnhydrated &&
        (statusRef.current !== 'RUNNING' ||
          (latestRemote.timerRunId ?? null) !== timerRunIdRef.current);

      if (isNewer || missedRunningRemote) {
        const snapshot = toRemoteTimerState(latestRemote);
        // Never feed cached serverNowMs on wake replay
        delete snapshot.serverNowMs;
        applyRemoteStateRef.current(snapshot);
      }

      // Acknowledge a server-auto-started run when the user returns to a visible tab
      if (
        latestRemote.status === 'RUNNING' &&
        latestRemote.timerRunId &&
        (latestRemote.serverAutoStartStreak ?? 0) > 0 &&
        isOnlineAndConnected() &&
        !acknowledgedRunIdsRef.current.has(latestRemote.timerRunId)
      ) {
        const runId = latestRemote.timerRunId;
        acknowledgedRunIdsRef.current.add(runId);
        convexTimerMutationsRef.current
          .acknowledgeActive({ timerRunId: runId })
          .then((res: any) => {
            if (res && typeof res === 'object') {
              recordServerClockSample(res.serverNowMs);
            }
          })
          .catch(() => {
            acknowledgedRunIdsRef.current.delete(runId);
          });
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
  }, [
    isConvexConfigured,
    lastLocalActionWallMsRef,
    localUpdatedAtRef,
    statusRef,
    timerRunIdRef,
    getServerAlignedNowMs,
    isOnlineAndConnected,
    recordServerClockSample,
  ]);

  return {
    publishLocalTimerState,
    publishTagUpdate,
    publishTimerCompletion,
    applyRemoteState,
    isInitialMountDoneRef,
    hasResolvedRemoteTimer,
    hasResolvedRemoteTimerRef,
    remoteTimerRef,
    isConvexConfigured,
  };
};

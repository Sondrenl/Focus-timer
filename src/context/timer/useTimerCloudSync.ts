import React, { useCallback, useEffect, useRef } from 'react';
import { SessionType, TimerStatus, RemoteTimerState } from '../../types/timer';
import { UserSettings } from '../../types/settings';
import { CoffeeCup } from '../../types/coffee';
import { broadcastTimerState } from '../../services/timer/TimerBroadcast';
import { wakeLockService } from '../../services/screen/WakeLockService';
import { useConvexTimer } from '../../services/convex/useConvexTimer';
import { getLogicalDayKey, setLastResetDayKey, INACTIVITY_THRESHOLD_MS } from '../../utils/newDayCheck';
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
    updatedAtMs: raw.updatedAtMs,
    serverNowMs: raw.serverNowMs,
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
  triggerCompletionConfetti,
}: UseTimerCloudSyncParams) => {
  const isConvexQueryAuthReady =
    !isAuthenticated || !isConvexAuthLoading || Boolean(isConvexAuthAuthenticated);

  const { isConvexConfigured, remoteTimer, mutations: convexTimerMutations } =
    useConvexTimer(isAuthenticated, isConvexQueryAuthReady);
  const convexTimerMutationsRef = useRef(convexTimerMutations);
  convexTimerMutationsRef.current = convexTimerMutations;

  const remoteTimerRef = useRef(remoteTimer);
  remoteTimerRef.current = remoteTimer;

  const hasResolvedRemoteTimer = Boolean(
    isConvexConfigured &&
      isAuthenticated &&
      remoteTimer !== undefined &&
      (remoteTimer !== null || isConvexQueryAuthReady)
  );
  const hasResolvedRemoteTimerRef = useRef<boolean>(false);
  hasResolvedRemoteTimerRef.current = hasResolvedRemoteTimer;

  const isInitialMountDoneRef = useRef<boolean>(false);
  const finalizedStaleRunIdsRef = useRef<Set<string>>(new Set());

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

  // Reset clock offset when signed out so local timers use local wall clock
  useEffect(() => {
    if (!isAuthenticated) {
      serverClockOffsetMsRef.current = 0;
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

      if (isConvexConfigured && isAuthenticatedRef.current) {
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
            })
            .then((res: any) => {
              if (res && typeof res === 'object') {
                recordServerClockSample(res.serverNowMs);
                // Only force-apply remote state if the conditional reset was explicitly REJECTED
                // by the server AND no newer direct user action occurred while in-flight.
                if (
                  resetOptions &&
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
      isConvexConfigured,
      localUpdatedAtRef,
      lastLocalActionWallMsRef,
      isAuthenticatedRef,
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

      if (isConvexConfigured && isAuthenticatedRef.current && currentStatus !== 'COMPLETED') {
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
      isConvexConfigured,
      isAuthenticatedRef,
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
    (payload: RemoteTimerState, completedTimerRunId?: string | null) => {
      localUpdatedAtRef.current = Math.max(localUpdatedAtRef.current, payload.updatedAtMs);
      // Protect optimistic completion transition from briefly flickering against an in-flight server IDLE echo
      lastLocalActionWallMsRef.current = Date.now();
      const dispatchActionWallMs = lastLocalActionWallMsRef.current;
      broadcastTimerState(payload);

      if (isConvexConfigured && isAuthenticatedRef.current) {
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
            if (res && typeof res === 'object') {
              recordServerClockSample(res.serverNowMs);

              if (typeof res.updatedAtMs === 'number') {
                // If the server rejected completion as too_early (positive client clock skew),
                // adopt the still-RUNNING server row using the freshly calibrated clock offset
                // without re-entering handleComplete in a retry loop.
                if (res.rejectedReason === 'too_early') {
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
          .catch(console.warn);
      }
    },
    [
      isConvexConfigured,
      localUpdatedAtRef,
      lastLocalActionWallMsRef,
      isAuthenticatedRef,
      recordServerClockSample,
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
      if (typeof remote.serverNowMs === 'number') {
        recordServerClockSample(remote.serverNowMs);
      }

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
        (remote.status === 'IDLE' || (remote.timerRunId && remote.timerRunId !== prevRunId))
      ) {
        // Another tab/device switched or stopped the run — invalidate stale cached draft
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
              getLogicalDayKey(remote.targetEndTime) !== getLogicalDayKey(wallNowMs) &&
              wallNowMs - remote.targetEndTime >= INACTIVITY_THRESHOLD_MS;
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

            // Self-heal: authoritatively reset Convex state only if this exact stale run is still active
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
      recordServerClockSample,
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

  // Adopt live Convex WebSocket timer updates instantly
  useEffect(() => {
    if (!isConvexConfigured || !remoteTimer) return;
    recordServerClockSample(remoteTimer.serverNowMs);

    const wallNow = Date.now();
    const hasRecentLocalAction = wallNow - lastLocalActionWallMsRef.current < 1500;
    const isNewer = remoteTimer.updatedAtMs > localUpdatedAtRef.current;

    // Adopt remote state unconditionally if no recent local action on this device,
    // or if the remote state timestamp is strictly newer than our aligned local state.
    if (!hasRecentLocalAction || isNewer) {
      applyRemoteStateRef.current(toRemoteTimerState(remoteTimer));
    }
  }, [
    remoteTimer,
    isConvexConfigured,
    lastLocalActionWallMsRef,
    localUpdatedAtRef,
    recordServerClockSample,
  ]);

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
  }, [
    isConvexConfigured,
    lastLocalActionWallMsRef,
    localUpdatedAtRef,
    statusRef,
    timerRunIdRef,
    getServerAlignedNowMs,
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

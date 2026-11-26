import React, { useCallback, useEffect, useRef } from 'react';
import { SessionType, TimerStatus, RemoteTimerState } from '../../types/timer';
import { UserSettings } from '../../types/settings';
import { wakeLockService } from '../../services/screen/WakeLockService';
import { useConvexTimer } from '../../services/convex/useConvexTimer';
import { getLogicalDayKey, setLastResetDayKey, INACTIVITY_THRESHOLD_MS } from '../../utils/newDayCheck';
import { telemetryTracker } from '../services';

export interface CompletedSessionFallback {
  tagId: string | null;
  sessionType: SessionType;
  durationSeconds: number;
  completedAt: string;
  timerRunId?: string | null;
}

export interface TimerSnapshot {
  sessionType?: SessionType;
  status: TimerStatus;
  currentCycle?: number;
  totalSeconds?: number;
  remainingSeconds: number;
  targetEndTime: number | null;
  timerRunId: string | null;
  activeTagId?: string | null;
}

export interface TimerSharedRefs {
  isAuthenticatedRef: React.MutableRefObject<boolean>;
  isConvexConnectedRef: React.MutableRefObject<boolean>;
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
  settingsRef: React.MutableRefObject<UserSettings>;
  profileRef: React.MutableRefObject<{ dailyGoalMinutes: number }>;
  handleCompleteRef: React.MutableRefObject<(silent?: boolean) => void>;
}

export interface ResetTimerOptions {
  onlyIfNotRunning?: boolean;
  onlyIfIdle?: boolean;
  expectedTimerRunId?: string;
  expectedUpdatedAtMs?: number;
}

interface UseTimerCloudSyncParams {
  isAuthenticated: boolean;
  isConvexAuthReady?: boolean;
  isConvexConnected?: boolean;
  refs: TimerSharedRefs;
  getServerAlignedNowMs: () => number;
  commitTimerSnapshot: (snapshot: TimerSnapshot) => void;
  getDurationForType: (type: SessionType) => number;
  dispatchCompletionAlert: (completedSessionType: SessionType, runId?: string | null) => void;
  triggerCompletionConfetti?: () => void;
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
  refs,
  getServerAlignedNowMs,
  commitTimerSnapshot,
  getDurationForType,
  dispatchCompletionAlert,
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
  const pendingPublishRef = useRef<{
    payload: RemoteTimerState;
    isUserAction: boolean;
    resetOptions?: ResetTimerOptions;
    dispatchActionWallMs: number;
  } | null>(null);
  const publishRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const publishRetryCountRef = useRef<number>(0);
  const PUBLISH_RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

  const clearPublishRetry = useCallback(() => {
    if (publishRetryTimeoutRef.current !== null) {
      clearTimeout(publishRetryTimeoutRef.current);
      publishRetryTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => clearPublishRetry, [clearPublishRetry]);

  const isOnlineAndConnected = useCallback((): boolean => {
    return Boolean(
      isConvexConfigured &&
        refs.isAuthenticatedRef.current &&
        refs.isConvexConnectedRef.current
    );
  }, [isConvexConfigured, refs]);

  const recordServerClockSample = useCallback(
    (serverNowMs?: number) => {
      if (typeof serverNowMs !== 'number' || !Number.isFinite(serverNowMs)) return;
      const rawOffset = serverNowMs - Date.now();
      if (Math.abs(rawOffset) > 12 * 60 * 60 * 1000) return;
      const prev = refs.serverClockOffsetMsRef.current;
      refs.serverClockOffsetMsRef.current =
        prev === 0 || Math.abs(rawOffset - prev) > 2000
          ? rawOffset
          : Math.round(prev * 0.7 + rawOffset * 0.3);
    },
    [refs]
  );

  useEffect(() => {
    if (!isAuthenticated) {
      refs.serverClockOffsetMsRef.current = 0;
      hasReconciledSignInRef.current = false;
      acknowledgedRunIdsRef.current.clear();
      pendingPublishRef.current = null;
      publishRetryCountRef.current = 0;
      clearPublishRetry();
    }
  }, [isAuthenticated, refs, clearPublishRetry]);

  const applyRemoteStateRef = useRef<(remote: RemoteTimerState, forceApply?: boolean) => void>(
    () => {}
  );

  const reconcileMutationResponse = useCallback(
    (res: any, dispatchActionWallMs: number) => {
      if (!res || typeof res !== 'object') return;
      recordServerClockSample(res.serverNowMs);
      if (
        res.applied === false &&
        typeof res.updatedAtMs === 'number' &&
        refs.lastLocalActionWallMsRef.current === dispatchActionWallMs
      ) {
        refs.localUpdatedAtRef.current = res.updatedAtMs;
        applyRemoteStateRef.current(toRemoteTimerState(res), true);
      } else if (typeof res.updatedAtMs === 'number') {
        refs.localUpdatedAtRef.current = Math.max(refs.localUpdatedAtRef.current, res.updatedAtMs);
      }
    },
    [recordServerClockSample, refs]
  );

  const dispatchTimerMutationRef = useRef<
    (entry: {
      payload: RemoteTimerState;
      isUserAction: boolean;
      resetOptions?: ResetTimerOptions;
      dispatchActionWallMs: number;
    }) => void
  >(() => {});

  const dispatchTimerMutation = useCallback(
    (entry: {
      payload: RemoteTimerState;
      isUserAction: boolean;
      resetOptions?: ResetTimerOptions;
      dispatchActionWallMs: number;
    }) => {
      if (!isOnlineAndConnected()) {
        return;
      }

      const { payload, resetOptions, dispatchActionWallMs } = entry;
      let mutationPromise: Promise<any> | null = null;
      if (payload.status === 'RUNNING') {
        const nowAligned = getServerAlignedNowMs();
        if (payload.targetEndTime !== null && payload.targetEndTime <= nowAligned) {
          if (pendingPublishRef.current?.dispatchActionWallMs === dispatchActionWallMs) {
            pendingPublishRef.current = null;
            publishRetryCountRef.current = 0;
          }
          return;
        }
        const computedRemaining =
          payload.targetEndTime !== null
            ? Math.max(
                1,
                Math.min(
                  Math.max(1, Math.round(payload.totalSeconds)),
                  Math.ceil((payload.targetEndTime - nowAligned) / 1000)
                )
              )
            : Math.max(1, Math.round(payload.remainingSeconds));
        mutationPromise = convexTimerMutationsRef.current.startTimer({
          sessionType: payload.sessionType,
          durationSeconds: Math.max(1, Math.round(payload.totalSeconds)),
          remainingSeconds: computedRemaining,
          totalSeconds: Math.max(1, Math.round(payload.totalSeconds)),
          currentCycle: Math.max(1, Math.round(payload.currentCycle)),
          tagId: payload.activeTagId || undefined,
          timerRunId: payload.timerRunId || `run-${Date.now()}`,
          clientActionAtMs: payload.updatedAtMs,
          clientTargetEndTimeMs: payload.targetEndTime ?? undefined,
        });
      } else if (payload.status === 'PAUSED') {
        mutationPromise = convexTimerMutationsRef.current.pauseTimer({
          remainingSeconds: Math.max(0, Math.round(payload.remainingSeconds)),
          tagId: payload.activeTagId || undefined,
          expectedTimerRunId: payload.timerRunId || undefined,
        });
      } else if (payload.status === 'IDLE') {
        mutationPromise = convexTimerMutationsRef.current.resetTimer({
          sessionType: payload.sessionType,
          durationSeconds: Math.max(1, Math.round(payload.totalSeconds)),
          currentCycle: Math.max(1, Math.round(payload.currentCycle)),
          tagId: payload.activeTagId || undefined,
          onlyIfNotRunning: resetOptions?.onlyIfNotRunning,
          onlyIfIdle: resetOptions?.onlyIfIdle,
          expectedTimerRunId: resetOptions?.expectedTimerRunId,
          expectedUpdatedAtMs: resetOptions?.expectedUpdatedAtMs,
          clientActionAtMs: payload.updatedAtMs,
        });
      }

      if (mutationPromise) {
        mutationPromise
          .then((res) => {
            if (pendingPublishRef.current?.dispatchActionWallMs === dispatchActionWallMs) {
              pendingPublishRef.current = null;
              publishRetryCountRef.current = 0;
              clearPublishRetry();
            }
            reconcileMutationResponse(res, dispatchActionWallMs);
          })
          .catch((err) => {
            console.warn(err);
            const currentPending = pendingPublishRef.current;
            if (
              currentPending &&
              currentPending.dispatchActionWallMs === dispatchActionWallMs &&
              isOnlineAndConnected() &&
              publishRetryCountRef.current < PUBLISH_RETRY_DELAYS_MS.length
            ) {
              const delayMs = PUBLISH_RETRY_DELAYS_MS[publishRetryCountRef.current];
              publishRetryCountRef.current += 1;
              clearPublishRetry();
              publishRetryTimeoutRef.current = setTimeout(() => {
                publishRetryTimeoutRef.current = null;
                const latestPending = pendingPublishRef.current;
                if (latestPending && latestPending.dispatchActionWallMs === dispatchActionWallMs) {
                  dispatchTimerMutationRef.current(latestPending);
                }
              }, delayMs);
            }
          });
      }
    },
    [isOnlineAndConnected, getServerAlignedNowMs, clearPublishRetry, reconcileMutationResponse]
  );
  dispatchTimerMutationRef.current = dispatchTimerMutation;

  const publishLocalTimerState = useCallback(
    (payload: RemoteTimerState, isUserAction = false, resetOptions?: ResetTimerOptions) => {
      refs.localUpdatedAtRef.current = Math.max(refs.localUpdatedAtRef.current, payload.updatedAtMs);
      if (isUserAction) {
        refs.lastLocalActionWallMsRef.current = Date.now();
      }
      const dispatchActionWallMs = refs.lastLocalActionWallMsRef.current;
      const entry = { payload, isUserAction, resetOptions, dispatchActionWallMs };

      if (isUserAction || payload.status === 'RUNNING') {
        pendingPublishRef.current = entry;
        publishRetryCountRef.current = 0;
        clearPublishRetry();
      }

      if (!isOnlineAndConnected()) {
        return;
      }

      dispatchTimerMutation(entry);
    },
    [isOnlineAndConnected, refs, clearPublishRetry, dispatchTimerMutation]
  );

  const publishTagUpdate = useCallback(
    (nextTagId: string | null) => {
      const nowAligned = getServerAlignedNowMs();
      refs.localUpdatedAtRef.current = Math.max(refs.localUpdatedAtRef.current, nowAligned);
      refs.lastLocalActionWallMsRef.current = Date.now();

      if (!isOnlineAndConnected()) {
        return;
      }

      const currentStatus = refs.statusRef.current;
      if (currentStatus !== 'COMPLETED') {
        convexTimerMutationsRef.current
          .updateTag({
            tagId: nextTagId || undefined,
            expectedStatus: currentStatus,
            expectedTimerRunId:
              currentStatus === 'RUNNING' || currentStatus === 'PAUSED'
                ? refs.timerRunIdRef.current || undefined
                : undefined,
          })
          .then((res: any) => {
            if (res && typeof res === 'object') {
              recordServerClockSample(res.serverNowMs);
              if (typeof res.updatedAtMs === 'number') {
                refs.localUpdatedAtRef.current = Math.max(
                  refs.localUpdatedAtRef.current,
                  res.updatedAtMs
                );
              }
            }
          })
          .catch(console.warn);
      }
    },
    [isOnlineAndConnected, getServerAlignedNowMs, refs, recordServerClockSample]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      isInitialMountDoneRef.current = true;
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handlePageHide = () => wakeLockService.release();
    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, []);

  const applyRemoteState = useCallback(
    (remote: RemoteTimerState, forceApply = false) => {
      const wallNowMs = Date.now();
      const nowMs = getServerAlignedNowMs();
      const MAX_FUTURE_DRIFT_MS = 10 * 60_000;
      const MAX_PAST_AGE_MS = 7 * 24 * 60 * 60 * 1000;

      if (
        typeof remote.updatedAtMs !== 'number' ||
        !Number.isFinite(remote.updatedAtMs) ||
        remote.updatedAtMs > nowMs + MAX_FUTURE_DRIFT_MS ||
        remote.updatedAtMs < nowMs - MAX_PAST_AGE_MS
      ) {
        console.warn('[Sync] Rejected remote timer state with abnormal timestamp:', remote.updatedAtMs);
        return;
      }

      const isServerCompletionOfCurrentRun = Boolean(
        refs.timerRunIdRef.current &&
          remote.lastCompletedTimerRunId === refs.timerRunIdRef.current
      );

      if (forceApply || isServerCompletionOfCurrentRun) {
        refs.lastLocalActionWallMsRef.current = 0;
      } else if (
        wallNowMs - refs.lastLocalActionWallMsRef.current < 1500 &&
        remote.updatedAtMs <= refs.localUpdatedAtRef.current
      ) {
        return;
      }

      const now = getServerAlignedNowMs();
      const STALE_ALERT_CUTOFF_MS = 60_000;
      const targetNearOrJustPassed =
        refs.targetEndTimeRef.current !== null &&
        refs.targetEndTimeRef.current - now <= 15_000 &&
        now - refs.targetEndTimeRef.current <= STALE_ALERT_CUTOFF_MS;
      const remoteUpdatedRecently = Math.abs(now - remote.updatedAtMs) <= STALE_ALERT_CUTOFF_MS;
      const remoteCompletedRecently = remote.status === 'COMPLETED' && remoteUpdatedRecently;
      const runAdvanced =
        remote.sessionType !== refs.sessionTypeRef.current ||
        (Boolean(refs.timerRunIdRef.current) &&
          remote.lastCompletedTimerRunId === refs.timerRunIdRef.current);
      const remoteCompletedToIdle =
        remote.status === 'IDLE' && runAdvanced && targetNearOrJustPassed && remoteUpdatedRecently;
      const remoteAutoStartedNextInterval =
        remote.status === 'RUNNING' &&
        Boolean(remote.timerRunId) &&
        remote.timerRunId !== refs.timerRunIdRef.current &&
        runAdvanced &&
        targetNearOrJustPassed &&
        remoteUpdatedRecently;

      const prevRunId = refs.timerRunIdRef.current;
      const prevSessionType = refs.sessionTypeRef.current;

      if (
        refs.statusRef.current === 'RUNNING' &&
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
        if (prevRunId) {
          void telemetryTracker.onSessionFinalized({
            attemptId: prevRunId,
            outcome: 'completed',
            sessionType: prevSessionType,
            plannedDurationSeconds: refs.totalSecondsRef.current,
            remainingSecondsAtEnd: 0,
            cycleIndex: refs.currentCycleRef.current,
            tagId: refs.activeTagIdRef.current,
            settings: refs.settingsRef.current,
            dailyGoalMinutes: refs.profileRef.current.dailyGoalMinutes ?? 120,
            wasStarted: true,
            targetEndTimeMs: refs.targetEndTimeRef.current,
          });
        }
      } else if (
        prevRunId &&
        (remote.status === 'IDLE' ||
          remote.status !== refs.statusRef.current ||
          (remote.timerRunId && remote.timerRunId !== prevRunId))
      ) {
        telemetryTracker.invalidateDraftCache();
      }

      refs.localUpdatedAtRef.current = forceApply
        ? remote.updatedAtMs
        : Math.max(refs.localUpdatedAtRef.current, remote.updatedAtMs);

      const resetStaleRemoteTimer = (
        isFromPreviousDay: boolean,
        remainingSecondsAtEnd: number,
        targetEndTimeMs: number | null,
        viaPublishLocal: boolean
      ) => {
        const resolvedSessionType: SessionType = isFromPreviousDay ? 'WORK' : remote.sessionType;
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
            remainingSecondsAtEnd,
            cycleIndex: remote.currentCycle || 1,
            tagId: remote.activeTagId ?? null,
            settings: refs.settingsRef.current,
            dailyGoalMinutes: refs.profileRef.current.dailyGoalMinutes ?? 120,
            wasStarted: true,
            targetEndTimeMs,
          });
        }

        commitTimerSnapshot({
          sessionType: resolvedSessionType,
          status: 'IDLE',
          currentCycle: resolvedCycle,
          totalSeconds: dur,
          remainingSeconds: dur,
          targetEndTime: null,
          timerRunId: null,
          activeTagId: remote.activeTagId,
        });
        void wakeLockService.release();

        if (isFromPreviousDay) {
          setLastResetDayKey(getLogicalDayKey(wallNowMs));
        }

        if (viaPublishLocal) {
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
            { onlyIfNotRunning: true, expectedUpdatedAtMs: remote.updatedAtMs }
          );
        } else if (isOnlineAndConnected()) {
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
      };

      if (remote.status === 'RUNNING' && remote.targetEndTime) {
        const diffMs = remote.targetEndTime - now;
        const rawDiffSec = Math.max(0, Math.ceil(diffMs / 1000));
        const diffSec =
          remote.totalSeconds > 0 ? Math.min(remote.totalSeconds, rawDiffSec) : rawDiffSec;

        if (diffMs < -900000) {
          const isFromPreviousDay =
            getLogicalDayKey(remote.targetEndTime) !== getLogicalDayKey(now) &&
            now - remote.targetEndTime >= INACTIVITY_THRESHOLD_MS;
          resetStaleRemoteTimer(isFromPreviousDay, 0, remote.targetEndTime, false);
          return;
        }

        if (refs.settingsRef.current.keepAwake !== false) {
          void wakeLockService.acquire();
        }
        commitTimerSnapshot({
          sessionType: remote.sessionType,
          status: 'RUNNING',
          currentCycle: remote.currentCycle || 1,
          totalSeconds: remote.totalSeconds,
          remainingSeconds: diffSec,
          targetEndTime: remote.targetEndTime,
          timerRunId: remote.timerRunId || null,
          activeTagId: remote.activeTagId,
        });
        if (remoteAutoStartedNextInterval && remote.timerRunId && diffSec > 0) {
          void telemetryTracker.onSessionStarted({
            attemptId: remote.timerRunId,
            sessionType: remote.sessionType,
            plannedDurationSeconds: remote.totalSeconds,
            cycleIndex: remote.currentCycle || 1,
            tagId: remote.activeTagId ?? null,
            autoStarted: true,
            settings: refs.settingsRef.current,
            dailyGoalMinutes: refs.profileRef.current.dailyGoalMinutes ?? 120,
            targetEndTimeMs: remote.targetEndTime,
            nowMs: now,
          });
        }
        refs.lastTickWallMsRef.current = Date.now();
      } else if (remote.status === 'PAUSED') {
        const PAUSED_TTL_MS = 24 * 60 * 60 * 1000;
        const isPausedFromPreviousDay =
          getLogicalDayKey(remote.updatedAtMs) !== getLogicalDayKey(wallNowMs) &&
          nowMs - remote.updatedAtMs >= INACTIVITY_THRESHOLD_MS;
        if (isPausedFromPreviousDay || nowMs - remote.updatedAtMs > PAUSED_TTL_MS) {
          resetStaleRemoteTimer(isPausedFromPreviousDay, remote.remainingSeconds, null, true);
          return;
        }

        const clampedPausedRemaining =
          remote.totalSeconds > 0
            ? Math.min(remote.totalSeconds, Math.max(0, remote.remainingSeconds))
            : Math.max(0, remote.remainingSeconds);

        commitTimerSnapshot({
          sessionType: remote.sessionType,
          status: 'PAUSED',
          currentCycle: remote.currentCycle || 1,
          totalSeconds: remote.totalSeconds,
          remainingSeconds: clampedPausedRemaining,
          targetEndTime: null,
          timerRunId: remote.timerRunId || null,
          activeTagId: remote.activeTagId,
        });
        void wakeLockService.release();
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

        commitTimerSnapshot({
          sessionType: resolvedSessionType,
          status: nextStatus,
          currentCycle: resolvedCycle,
          totalSeconds: tot,
          remainingSeconds: dur,
          targetEndTime: null,
          timerRunId: remote.timerRunId || null,
          activeTagId: remote.activeTagId,
        });
        void wakeLockService.release();

        if (isFromPreviousDay) {
          setLastResetDayKey(getLogicalDayKey(wallNowMs));
          if (
            remote.sessionType !== 'WORK' ||
            (remote.currentCycle || 1) !== 1 ||
            remote.remainingSeconds !== dur ||
            remote.totalSeconds !== dur
          ) {
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
              { onlyIfIdle: true, expectedUpdatedAtMs: remote.updatedAtMs }
            );
          }
        }
      }
    },
    [
      isOnlineAndConnected,
      getServerAlignedNowMs,
      commitTimerSnapshot,
      getDurationForType,
      dispatchCompletionAlert,
      triggerCompletionConfetti,
      publishLocalTimerState,
      refs,
    ]
  );

  applyRemoteStateRef.current = applyRemoteState;

  const flushPendingLocalPublish = useCallback((): boolean => {
    const pending = pendingPublishRef.current;
    if (!pending || !isOnlineAndConnected()) return false;
    publishRetryCountRef.current = 0;
    clearPublishRetry();
    dispatchTimerMutation(pending);
    return true;
  }, [isOnlineAndConnected, clearPublishRetry, dispatchTimerMutation]);

  const promoteLocalActiveTimerIfNewer = useCallback(
    (remote: typeof remoteTimer) => {
      if (!isOnlineAndConnected() || refs.statusRef.current !== 'RUNNING') return false;

      const nowAligned = getServerAlignedNowMs();
      const targetEnd = refs.targetEndTimeRef.current;
      if (!targetEnd || targetEnd <= nowAligned) return false;

      const remoteIsEmptyOrOlderInactive =
        remote === null ||
        (remote !== undefined &&
          (remote.status === 'IDLE' || remote.status === 'PAUSED') &&
          refs.localUpdatedAtRef.current > remote.updatedAtMs);

      if (!remoteIsEmptyOrOlderInactive) return false;

      const remainingSec = Math.max(
        1,
        Math.min(refs.totalSecondsRef.current, Math.ceil((targetEnd - nowAligned) / 1000))
      );
      publishLocalTimerState(
        {
          sessionType: refs.sessionTypeRef.current,
          status: 'RUNNING',
          remainingSeconds: remainingSec,
          totalSeconds: refs.totalSecondsRef.current,
          targetEndTime: targetEnd,
          currentCycle: refs.currentCycleRef.current,
          activeTagId: refs.activeTagIdRef.current,
          timerRunId: refs.timerRunIdRef.current || `run-${nowAligned}`,
          updatedAtMs: Math.max(refs.localUpdatedAtRef.current, nowAligned),
        },
        false
      );
      return true;
    },
    [isOnlineAndConnected, refs, getServerAlignedNowMs, publishLocalTimerState]
  );

  const acknowledgeRemoteRunIfActive = useCallback(
    (remote: NonNullable<typeof remoteTimer>) => {
      if (
        remote.status === 'RUNNING' &&
        remote.timerRunId &&
        (remote.serverAutoStartStreak ?? 0) > 0 &&
        isOnlineAndConnected() &&
        !acknowledgedRunIdsRef.current.has(remote.timerRunId) &&
        (typeof document === 'undefined' || document.visibilityState === 'visible')
      ) {
        const runId = remote.timerRunId;
        acknowledgedRunIdsRef.current.add(runId);
        convexTimerMutationsRef.current
          .acknowledgeActive({ timerRunId: runId })
          .then((res: any) => {
            if (res && typeof res === 'object') recordServerClockSample(res.serverNowMs);
          })
          .catch(() => {
            acknowledgedRunIdsRef.current.delete(runId);
          });
      }
    },
    [isOnlineAndConnected, recordServerClockSample]
  );

  useEffect(() => {
    if (!isConvexConfigured || !hasResolvedRemoteTimer) return;

    if (!hasReconciledSignInRef.current) {
      hasReconciledSignInRef.current = true;
      if (flushPendingLocalPublish() || promoteLocalActiveTimerIfNewer(remoteTimer)) return;
    }

    if (!remoteTimer) return;

    const hasRecentLocalAction = Date.now() - refs.lastLocalActionWallMsRef.current < 1500;
    const isNewer = remoteTimer.updatedAtMs > refs.localUpdatedAtRef.current;
    const isServerCompletionOfCurrentRun = Boolean(
      refs.timerRunIdRef.current &&
        remoteTimer.lastCompletedTimerRunId === refs.timerRunIdRef.current
    );

    const pending = pendingPublishRef.current;
    if (
      pending &&
      !isServerCompletionOfCurrentRun &&
      remoteTimer.updatedAtMs <= pending.payload.updatedAtMs
    ) {
      flushPendingLocalPublish();
      return;
    }

    if (!hasRecentLocalAction || isNewer || isServerCompletionOfCurrentRun) {
      applyRemoteStateRef.current(toRemoteTimerState(remoteTimer), isServerCompletionOfCurrentRun);
    }

    acknowledgeRemoteRunIfActive(remoteTimer);
  }, [
    remoteTimer,
    hasResolvedRemoteTimer,
    isConvexConfigured,
    refs,
    flushPendingLocalPublish,
    promoteLocalActiveTimerIfNewer,
    acknowledgeRemoteRunIfActive,
  ]);

  useEffect(() => {
    const wasConnected = prevConnectedRef.current;
    prevConnectedRef.current = isConvexConnected;
    if (!wasConnected && isConvexConnected) {
      if (flushPendingLocalPublish()) {
        return;
      }
      if (hasResolvedRemoteTimer) {
        const latestRemote = remoteTimerRef.current;
        if (!promoteLocalActiveTimerIfNewer(latestRemote) && latestRemote) {
          applyRemoteStateRef.current(toRemoteTimerState(latestRemote));
        }
      }
    }
  }, [isConvexConnected, hasResolvedRemoteTimer, flushPendingLocalPublish, promoteLocalActiveTimerIfNewer]);

  useEffect(() => {
    if (!isConvexConfigured) return;

    const handleWakeResync = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const latestRemote = remoteTimerRef.current;
      if (!latestRemote) return;
      if (Date.now() - refs.lastLocalActionWallMsRef.current < 1500) return;

      const nowAligned = getServerAlignedNowMs();
      const isNewer = latestRemote.updatedAtMs > refs.localUpdatedAtRef.current;
      const isSameOrUnhydrated =
        refs.localUpdatedAtRef.current === 0 ||
        latestRemote.updatedAtMs >= refs.localUpdatedAtRef.current;
      const missedRunningRemote =
        latestRemote.status === 'RUNNING' &&
        typeof latestRemote.targetEndTime === 'number' &&
        latestRemote.targetEndTime > nowAligned &&
        isSameOrUnhydrated &&
        (refs.statusRef.current !== 'RUNNING' ||
          (latestRemote.timerRunId ?? null) !== refs.timerRunIdRef.current);

      if (isNewer || missedRunningRemote) {
        const snapshot = toRemoteTimerState(latestRemote);
        delete snapshot.serverNowMs;
        applyRemoteStateRef.current(snapshot);
      }

      acknowledgeRemoteRunIfActive(latestRemote);
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
  }, [isConvexConfigured, refs, getServerAlignedNowMs, acknowledgeRemoteRunIfActive]);

  return {
    isOnlineAndConnected,
    publishLocalTimerState,
    publishTagUpdate,
    applyRemoteState,
    isInitialMountDoneRef,
    hasResolvedRemoteTimer,
    hasResolvedRemoteTimerRef,
    remoteTimerRef,
    isConvexConfigured,
  };
};

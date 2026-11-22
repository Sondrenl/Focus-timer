import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { CompletedSession } from '../../types/session';
import { isSampleSessionId } from '../../services/repository/SessionRepository';
import {
  broadcastSession,
  subscribeAuthEvent,
  subscribeSessions,
  subscribeSessionsSync,
  subscribeReset,
} from '../../services/timer/TimerBroadcast';
import { isPreviewOrDev, isProduction } from '../../utils/environment';
import { sessionRepository } from '../../context/services';
import { useAuthProfile } from '../../context/AuthProfileContext';
import {
  enqueueOutboxOperation,
  getLocalDataOwnerUserId,
  markGuestDataModified,
  readOfflineOutbox,
  removeOutboxOperation,
} from '../../services/sync/offlineOutbox';

interface UseSessionsDataParams {
  isEffectiveAuthenticated: boolean;
  isConvexAuthReady: boolean;
  isAdoptionPaused: boolean;
  currentUserId: string | null;
  convexSync: ReturnType<typeof useAuthProfile>['convexSync'];
}

export function useSessionsData({
  isEffectiveAuthenticated,
  isConvexAuthReady,
  isAdoptionPaused,
  currentUserId,
  convexSync,
}: UseSessionsDataParams) {
  const {
    isConvexConfigured,
    isConvexConnected,
    convexSessions,
    mutations: convexMutations,
  } = convexSync;

  const [sessions, setSessions] = useState<CompletedSession[]>([]);
  const sessionsRef = useRef<CompletedSession[]>(sessions);
  sessionsRef.current = sessions;

  const pendingAddsRef = useRef<Map<string, CompletedSession>>(new Map());
  const isConvexConnectedRef = useRef<boolean>(isConvexConnected);
  isConvexConnectedRef.current = isConvexConnected;

  const isDemoEnvironment = useMemo(() => isPreviewOrDev(), []);

  const getActiveOwnerUserId = useCallback((): string | null => {
    return currentUserId ?? getLocalDataOwnerUserId();
  }, [currentUserId]);

  // Initial load of sessions from local storage
  useEffect(() => {
    async function initSessions() {
      const loadedSessions = await sessionRepository.getAll();

      // If production OR authenticated with a real account, purge any dev sample sessions immediately
      const shouldPurgeSample = isProduction() || isEffectiveAuthenticated;
      const cleanSessions = shouldPurgeSample
        ? loadedSessions.filter((s) => !isSampleSessionId(s.id))
        : loadedSessions;

      setSessions(cleanSessions);

      if (shouldPurgeSample && cleanSessions.length !== loadedSessions.length) {
        await sessionRepository.purgeSampleSessions();
      }
    }

    initSessions();
  }, []);

  // Immediately purge dev sample sessions whenever a user signs in so sample data never leaks into their account,
  // and clear pending cloud-reconciliation refs whenever signed out
  useEffect(() => {
    if (!isEffectiveAuthenticated) {
      pendingAddsRef.current.clear();
      return;
    }
    sessionRepository.purgeSampleSessions().then((clean) => {
      setSessions((prev) => {
        const filtered = prev.filter((s) => !isSampleSessionId(s.id));
        return filtered.length !== prev.length ? clean : prev;
      });
    });
  }, [isEffectiveAuthenticated]);

  // Reactive adoption of Convex sessions (paused during migration, outbox replay, and replace imports)
  useEffect(() => {
    if (!isConvexAuthReady || isAdoptionPaused || !Array.isArray(convexSessions)) return;

    const ownerId = getActiveOwnerUserId();
    const outboxOps = ownerId ? readOfflineOutbox(ownerId) : [];

    // If a reset_all is pending in the offline outbox, preserve the cleared local state until replayed
    if (outboxOps.some((op) => op.kind === 'reset_all')) {
      return;
    }

    const serverSessions = convexSessions as CompletedSession[];
    const outboxAdds: CompletedSession[] = outboxOps
      .filter((op): op is Extract<typeof op, { kind: 'record_session' }> => op.kind === 'record_session')
      .map((op) => ({
        id: op.payload.localId,
        tagId: op.payload.tagId ?? null,
        sessionType: op.payload.sessionType,
        durationSeconds: op.payload.durationSeconds,
        completedAt: op.payload.completedAt,
        ...(op.payload.timerRunId ? { timerRunId: op.payload.timerRunId } : {}),
      }));

    const pendingMap = new Map<string, CompletedSession>();
    for (const s of outboxAdds) {
      pendingMap.set(s.id, s);
    }
    for (const [id, s] of pendingAddsRef.current.entries()) {
      pendingMap.set(id, s);
    }
    const pendingAdds = Array.from(pendingMap.values());

    const serverIds = new Set(serverSessions.map((s) => s.id));
    const serverRunIds = new Set(
      serverSessions.map((s) => s.timerRunId).filter((r): r is string => Boolean(r))
    );
    const serverTimes = serverSessions.map((s) => ({
      sessionType: s.sessionType,
      completedAt: s.completedAt,
      timerRunId: s.timerRunId ?? null,
      ms: new Date(s.completedAt).getTime(),
    }));

    const unconfirmedAdds = pendingAdds.filter((a) => {
      if (serverIds.has(a.id)) return false;
      if (a.timerRunId && serverRunIds.has(a.timerRunId)) return false;
      const aMs = new Date(a.completedAt).getTime();
      return !serverTimes.some((r) => {
        if (a.timerRunId && r.timerRunId) {
          return a.timerRunId === r.timerRunId;
        }
        return (
          r.completedAt === a.completedAt ||
          (r.sessionType === a.sessionType &&
            !isNaN(aMs) &&
            !isNaN(r.ms) &&
            Math.abs(r.ms - aMs) <= 45000)
        );
      });
    });

    const sorted = [...serverSessions, ...unconfirmedAdds].sort(
      (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
    );

    const prev = sessionsRef.current;
    const isSame =
      prev.length === sorted.length &&
      prev.every(
        (s, i) =>
          s.id === sorted[i].id &&
          s.sessionType === sorted[i].sessionType &&
          s.durationSeconds === sorted[i].durationSeconds &&
          s.completedAt === sorted[i].completedAt &&
          s.tagId === sorted[i].tagId &&
          (s.timerRunId ?? null) === (sorted[i].timerRunId ?? null)
      );

    if (!isSame) {
      sessionsRef.current = sorted;
      setSessions(sorted);
      void sessionRepository.saveAll(sorted);
    }
  }, [convexSessions, isConvexAuthReady, isAdoptionPaused, getActiveOwnerUserId]);

  // Multi-tab BroadcastChannel synchronization for sessions, bulk imports, resets, and logout
  useEffect(() => {
    const unsubSessions = subscribeSessions((incomingSession) => {
      const incomingMs = new Date(incomingSession.completedAt).getTime();
      setSessions((prev) => {
        const isDuplicate = prev.some((s) => {
          if (s.id === incomingSession.id) return true;
          if (s.timerRunId && incomingSession.timerRunId) {
            return s.timerRunId === incomingSession.timerRunId;
          }
          if (s.sessionType !== incomingSession.sessionType) return false;
          const sMs = new Date(s.completedAt).getTime();
          return !isNaN(sMs) && !isNaN(incomingMs) && Math.abs(sMs - incomingMs) <= 5000;
        });
        if (isDuplicate) return prev;
        return [...prev, incomingSession].sort(
          (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
        );
      });
    });

    const unsubSessionsSync = subscribeSessionsSync((incomingSessions) => {
      sessionsRef.current = incomingSessions;
      setSessions(incomingSessions);
    });

    const unsubReset = subscribeReset(() => {
      pendingAddsRef.current.clear();
      sessionsRef.current = [];
      setSessions([]);
    });

    const unsubAuth = subscribeAuthEvent((payload) => {
      if (payload.action === 'logout') {
        pendingAddsRef.current.clear();
        sessionsRef.current = [];
        setSessions([]);
      }
    });

    return () => {
      unsubSessions();
      unsubSessionsSync();
      unsubReset();
      unsubAuth();
    };
  }, []);

  const recordSession = useCallback(
    async (sessionData: Omit<CompletedSession, 'id'> & { id?: string }): Promise<CompletedSession> => {
      const existingAll = await sessionRepository.getAll();
      const targetMs = new Date(sessionData.completedAt).getTime();
      const existingDuplicate = existingAll.find((s) => {
        if (sessionData.id && s.id === sessionData.id) return true;
        if (sessionData.timerRunId && s.timerRunId) {
          return s.timerRunId === sessionData.timerRunId;
        }
        if (s.sessionType !== sessionData.sessionType) return false;
        const sMs = new Date(s.completedAt).getTime();
        return !isNaN(sMs) && !isNaN(targetMs) && Math.abs(sMs - targetMs) <= 5000;
      });
      if (existingDuplicate) {
        return existingDuplicate;
      }

      const created = await sessionRepository.add(sessionData);
      if (!isEffectiveAuthenticated) {
        markGuestDataModified();
      }

      const shouldSyncToCloud =
        isConvexConfigured && isEffectiveAuthenticated && !isSampleSessionId(created.id);
      const ownerId = shouldSyncToCloud ? getActiveOwnerUserId() : null;
      const queuedOp = ownerId
        ? enqueueOutboxOperation(ownerId, {
            kind: 'record_session',
            payload: {
              localId: created.id,
              tagId: sessionData.tagId || undefined,
              sessionType: sessionData.sessionType,
              durationSeconds: sessionData.durationSeconds,
              completedAt: created.completedAt,
              timerRunId: sessionData.timerRunId || undefined,
            },
          })
        : null;

      if (shouldSyncToCloud) {
        pendingAddsRef.current.set(created.id, created);
      }

      setSessions((prev) => {
        if (prev.some((s) => s.id === created.id)) return prev;
        const base = prev.filter((s) => !isSampleSessionId(s.id));
        const next = [...base, created];
        if (base.length > 0) {
          const lastMs = new Date(base[base.length - 1].completedAt).getTime();
          const createdMs = new Date(created.completedAt).getTime();
          if (!Number.isNaN(lastMs) && !Number.isNaN(createdMs) && createdMs < lastMs) {
            next.sort(
              (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
            );
          }
        }
        return next;
      });
      broadcastSession(created);

      if (shouldSyncToCloud && isConvexAuthReady && isConvexConnectedRef.current) {
        convexMutations
          .recordSession({
            tagId: sessionData.tagId || undefined,
            sessionType: sessionData.sessionType,
            durationSeconds: sessionData.durationSeconds,
            completedAt: created.completedAt,
            timerRunId: sessionData.timerRunId || undefined,
          })
          .then((serverSession) => {
            pendingAddsRef.current.delete(created.id);
            if (queuedOp) {
              removeOutboxOperation(queuedOp.id);
            }
            if (serverSession && serverSession.id) {
              setSessions((prev) => {
                if (
                  created.id !== serverSession.id &&
                  prev.some((s) => s.id === serverSession.id)
                ) {
                  return prev.filter((s) => s.id !== created.id);
                }
                return prev.map((s) =>
                  s.id === created.id
                    ? { ...s, id: serverSession.id, completedAt: serverSession.completedAt }
                    : s
                );
              });
              void sessionRepository.replaceId(created.id, serverSession.id, {
                completedAt: serverSession.completedAt,
              });
            }
          })
          .catch((err) => {
            // Keep queuedOp in the persistent offline outbox so it replays on reconnect
            pendingAddsRef.current.delete(created.id);
            console.warn(err);
          });
      } else if (shouldSyncToCloud) {
        pendingAddsRef.current.delete(created.id);
      }
      return created;
    },
    [
      isConvexConfigured,
      isEffectiveAuthenticated,
      isConvexAuthReady,
      convexMutations,
      getActiveOwnerUserId,
    ]
  );

  // Sample data is strictly allowed ONLY on non-production builds when NOT signed into a real account
  const reloadSampleData = useCallback(async (): Promise<void> => {
    if (isProduction() || isEffectiveAuthenticated) return;
    const samples = await sessionRepository.loadSampleData();
    setSessions(samples);
  }, [isEffectiveAuthenticated]);

  return {
    sessions,
    setSessions,
    isDemoEnvironment,
    recordSession,
    reloadSampleData,
  };
}

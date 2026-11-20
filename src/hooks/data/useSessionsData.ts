import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { CompletedSession } from '../../types/session';
import { isSampleSessionId } from '../../services/repository/SessionRepository';
import {
  broadcastSession,
  subscribeSessions,
  subscribeReset,
} from '../../services/timer/TimerBroadcast';
import { isPreviewOrDev, isProduction } from '../../utils/environment';
import { sessionRepository } from '../../context/services';
import { useAuthProfile } from '../../context/AuthProfileContext';

interface UseSessionsDataParams {
  isEffectiveAuthenticated: boolean;
  convexSync: ReturnType<typeof useAuthProfile>['convexSync'];
}

export function useSessionsData({
  isEffectiveAuthenticated,
  convexSync,
}: UseSessionsDataParams) {
  const { isConvexConfigured, convexSessions, mutations: convexMutations } = convexSync;

  const [sessions, setSessions] = useState<CompletedSession[]>([]);

  const pendingAddsRef = useRef<Map<string, CompletedSession>>(new Map());

  const isDemoEnvironment = useMemo(() => isPreviewOrDev(), []);

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

  // Immediately purge dev sample sessions whenever a user signs in so sample data never leaks into their account
  useEffect(() => {
    if (!isEffectiveAuthenticated) return;
    sessionRepository.purgeSampleSessions().then((clean) => {
      setSessions((prev) => {
        const filtered = prev.filter((s) => !isSampleSessionId(s.id));
        return filtered.length !== prev.length ? clean : prev;
      });
    });
  }, [isEffectiveAuthenticated]);

  // Reactive adoption of Convex sessions
  useEffect(() => {
    if (!isEffectiveAuthenticated || !Array.isArray(convexSessions)) return;
    const serverSessions = convexSessions as CompletedSession[];
    const pendingAdds = Array.from(pendingAddsRef.current.values());

    const serverIds = new Set(serverSessions.map((s) => s.id));
    const serverTimes = serverSessions.map((s) => ({
      sessionType: s.sessionType,
      completedAt: s.completedAt,
      ms: new Date(s.completedAt).getTime(),
    }));

    const unconfirmedAdds = pendingAdds.filter((a) => {
      if (serverIds.has(a.id)) return false;
      const aMs = new Date(a.completedAt).getTime();
      return !serverTimes.some(
        (r) =>
          r.completedAt === a.completedAt ||
          (r.sessionType === a.sessionType &&
            !isNaN(aMs) &&
            !isNaN(r.ms) &&
            Math.abs(r.ms - aMs) <= 45000)
      );
    });

    const sorted = [...serverSessions, ...unconfirmedAdds].sort(
      (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
    );
    setSessions((prev) => {
      if (
        prev.length === sorted.length &&
        prev.every(
          (s, i) =>
            s.id === sorted[i].id &&
            s.sessionType === sorted[i].sessionType &&
            s.durationSeconds === sorted[i].durationSeconds &&
            s.completedAt === sorted[i].completedAt &&
            s.tagId === sorted[i].tagId
        )
      ) {
        return prev;
      }
      sessionRepository.saveAll(sorted);
      return sorted;
    });
  }, [convexSessions, isEffectiveAuthenticated]);

  // Multi-tab BroadcastChannel synchronization for sessions
  useEffect(() => {
    const unsubSessions = subscribeSessions((incomingSession) => {
      const incomingMs = new Date(incomingSession.completedAt).getTime();
      setSessions((prev) => {
        const isDuplicate = prev.some((s) => {
          if (s.id === incomingSession.id) return true;
          if (s.sessionType !== incomingSession.sessionType) return false;
          const sMs = new Date(s.completedAt).getTime();
          return !isNaN(sMs) && !isNaN(incomingMs) && Math.abs(sMs - incomingMs) <= 5000;
        });
        if (isDuplicate) return prev;
        const next = [...prev, incomingSession].sort(
          (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
        );
        sessionRepository.saveAll(next);
        return next;
      });
    });

    const unsubReset = subscribeReset(() => {
      pendingAddsRef.current.clear();
      setSessions([]);
    });

    return () => {
      unsubSessions();
      unsubReset();
    };
  }, []);

  const recordSession = useCallback(
    async (sessionData: Omit<CompletedSession, 'id'> & { id?: string }): Promise<CompletedSession> => {
      const existingAll = await sessionRepository.getAll();
      const targetMs = new Date(sessionData.completedAt).getTime();
      const existingDuplicate = existingAll.find((s) => {
        if (sessionData.id && s.id === sessionData.id) return true;
        if (s.sessionType !== sessionData.sessionType) return false;
        const sMs = new Date(s.completedAt).getTime();
        return !isNaN(sMs) && !isNaN(targetMs) && Math.abs(sMs - targetMs) <= 5000;
      });
      if (existingDuplicate) {
        return existingDuplicate;
      }

      const created = await sessionRepository.add(sessionData);
      if (!isSampleSessionId(created.id)) {
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

      if (isConvexConfigured && isEffectiveAuthenticated && !isSampleSessionId(created.id)) {
        convexMutations
          .recordSession({
            tagId: sessionData.tagId || undefined,
            sessionType: sessionData.sessionType,
            durationSeconds: sessionData.durationSeconds,
            completedAt: created.completedAt,
          })
          .then((serverSession) => {
            pendingAddsRef.current.delete(created.id);
            if (serverSession && serverSession.id) {
              setSessions((prev) =>
                prev.map((s) =>
                  s.id === created.id
                    ? { ...s, id: serverSession.id, completedAt: serverSession.completedAt }
                    : s
                )
              );
              sessionRepository.getAll().then((all) => {
                const updated = all.map((s) =>
                  s.id === created.id
                    ? { ...s, id: serverSession.id, completedAt: serverSession.completedAt }
                    : s
                );
                sessionRepository.saveAll(updated);
              });
            }
          })
          .catch((err) => {
            pendingAddsRef.current.delete(created.id);
            console.warn(err);
          });
      }
      return created;
    },
    [isConvexConfigured, isEffectiveAuthenticated, convexMutations]
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

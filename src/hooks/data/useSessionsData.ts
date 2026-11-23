import { useState, useEffect, useCallback, useMemo } from 'react';
import { CompletedSession } from '../../types/session';
import { isSampleSessionId } from '../../services/storage/guestRepositories';
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
import { markGuestDataModified } from '../../services/sync/offlineOutbox';

interface UseSessionsDataParams {
  isEffectiveAuthenticated: boolean;
  isConvexAuthReady?: boolean;
  isAdoptionPaused?: boolean;
  convexSync: ReturnType<typeof useAuthProfile>['convexSync'];
}

export function useSessionsData({
  isEffectiveAuthenticated,
  convexSync,
}: UseSessionsDataParams) {
  const { isConvexConfigured, convexSessions, mutations: convexMutations } = convexSync;
  const isCloudMode = isConvexConfigured && isEffectiveAuthenticated;

  const [guestSessions, setGuestSessions] = useState<CompletedSession[]>([]);
  const isDemoEnvironment = useMemo(() => isPreviewOrDev(), []);

  // Initial load of guest sessions from localStorage
  useEffect(() => {
    sessionRepository.getAll().then((loaded) => {
      const shouldPurgeSample = isProduction() || isEffectiveAuthenticated;
      const clean = shouldPurgeSample
        ? loaded.filter((s) => !isSampleSessionId(s.id))
        : loaded;
      setGuestSessions(clean);
      if (shouldPurgeSample && clean.length !== loaded.length) {
        void sessionRepository.purgeSampleSessions();
      }
    });
  }, [isEffectiveAuthenticated]);

  // Multi-tab BroadcastChannel sync for guest mode and resets
  useEffect(() => {
    const unsubSessions = subscribeSessions((incoming) => {
      setGuestSessions((prev) => {
        if (prev.some((s) => s.id === incoming.id)) return prev;
        return [...prev, incoming].sort(
          (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
        );
      });
    });

    const unsubSessionsSync = subscribeSessionsSync((incomingSessions) => {
      setGuestSessions(incomingSessions);
    });

    const unsubReset = subscribeReset(() => {
      setGuestSessions([]);
    });

    const unsubAuth = subscribeAuthEvent((payload) => {
      if (payload.action === 'logout') {
        setGuestSessions([]);
      }
    });

    return () => {
      unsubSessions();
      unsubSessionsSync();
      unsubReset();
      unsubAuth();
    };
  }, []);

  // When signed in, Convex query is the direct source of truth.
  const sessions = useMemo<CompletedSession[]>(() => {
    if (isCloudMode) {
      return Array.isArray(convexSessions) ? (convexSessions as CompletedSession[]) : [];
    }
    return guestSessions;
  }, [isCloudMode, convexSessions, guestSessions]);

  const recordSession = useCallback(
    async (
      sessionData: Omit<CompletedSession, 'id'> & { id?: string }
    ): Promise<CompletedSession> => {
      if (isCloudMode) {
        const serverSession = await convexMutations.recordSession({
          tagId: sessionData.tagId || undefined,
          sessionType: sessionData.sessionType,
          durationSeconds: sessionData.durationSeconds,
          completedAt: sessionData.completedAt,
          timerRunId: sessionData.timerRunId || undefined,
        });
        return {
          id: serverSession?.id ?? sessionData.id ?? `session-${Date.now()}`,
          tagId: serverSession?.tagId ?? sessionData.tagId ?? null,
          sessionType: sessionData.sessionType,
          durationSeconds: sessionData.durationSeconds,
          completedAt: serverSession?.completedAt ?? sessionData.completedAt,
          ...(sessionData.timerRunId ? { timerRunId: sessionData.timerRunId } : {}),
        };
      }

      const created = await sessionRepository.add(sessionData);
      markGuestDataModified();
      setGuestSessions((prev) => {
        if (prev.some((s) => s.id === created.id)) return prev;
        return [...prev.filter((s) => !isSampleSessionId(s.id)), created].sort(
          (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
        );
      });
      broadcastSession(created);
      return created;
    },
    [isCloudMode, convexMutations]
  );

  const reloadSampleData = useCallback(async (): Promise<void> => {
    if (isProduction() || isEffectiveAuthenticated) return;
    const samples = await sessionRepository.loadSampleData();
    setGuestSessions(samples);
  }, [isEffectiveAuthenticated]);

  return {
    sessions,
    setSessions: setGuestSessions,
    isDemoEnvironment,
    recordSession,
    reloadSampleData,
  };
}

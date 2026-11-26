import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { CompletedSession } from '../../types/session';
import { sessionRepository } from '../../context/services';
import { useAuthProfile } from '../../context/AuthProfileContext';
import { markGuestDataModified } from '../../services/sync/offlineOutbox';

interface UseSessionsDataParams {
  isAuthenticated: boolean;
  isAdoptionPaused?: boolean;
  convexSync: ReturnType<typeof useAuthProfile>['convexSync'];
}

export function useSessionsData({
  isAuthenticated,
  convexSync,
}: UseSessionsDataParams) {
  const { isConvexConfigured, convexSessions, mutations: convexMutations } = convexSync;
  const isCloudMode = isConvexConfigured && isAuthenticated;

  const [guestSessions, setGuestSessions] = useState<CompletedSession[]>([]);
  const wasAuthenticatedRef = useRef<boolean>(isAuthenticated);

  // Initial load of guest sessions from localStorage
  useEffect(() => {
    sessionRepository.getAll().then(setGuestSessions);
  }, []);

  // Clear in-memory guest sessions on sign-out so pre-sign-in data never reappears
  useEffect(() => {
    const wasAuth = wasAuthenticatedRef.current;
    wasAuthenticatedRef.current = isAuthenticated;
    if (wasAuth && !isAuthenticated) {
      setGuestSessions([]);
    }
  }, [isAuthenticated]);

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
        return [...prev, created].sort(
          (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
        );
      });
      return created;
    },
    [isCloudMode, convexMutations]
  );

  return {
    sessions,
    setSessions: setGuestSessions,
    recordSession,
  };
}

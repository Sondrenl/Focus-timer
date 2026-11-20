import { useEffect, useCallback, useRef } from 'react';
import { isSampleSessionId } from '../../services/repository/SessionRepository';
import {
  tagRepository,
  sessionRepository,
  coffeeRepository,
  telemetryTracker,
} from '../../context/services';
import {
  MlEvent,
  MlTelemetryExport,
  SessionAttempt,
} from '../../types/telemetry';
import { useAuthProfile } from '../../context/AuthProfileContext';
import { buildLocalTimeContext } from '../../utils/telemetryContext';
import {
  TAG_ID_REGEX,
  readHydrationWatermark,
  shiftDateDays,
  writeHydrationWatermark,
} from '../../utils/backupSanitizers';

const BACKUP_CHUNK_SIZE = 400;
const TELEMETRY_ATTEMPT_CHUNK_SIZE = 400;
const TELEMETRY_EVENT_CHUNK_SIZE = 800;

interface UseCloudMigrationParams {
  isEffectiveAuthenticated: boolean;
  convexSync: ReturnType<typeof useAuthProfile>['convexSync'];
}

export function useCloudMigration({
  isEffectiveAuthenticated,
  convexSync,
}: UseCloudMigrationParams) {
  const {
    isConvexConfigured,
    convexUser,
    convexCoffee,
    convexSessions,
    fetchTelemetryAttempts,
    fetchTelemetryEvents,
    mutations: convexMutations,
  } = convexSync;

  const hasMigratedToCloudRef = useRef<boolean>(false);

  // Bind passive ML telemetry cloud sink when authenticated and Convex is configured
  useEffect(() => {
    if (
      isConvexConfigured &&
      isEffectiveAuthenticated &&
      convexMutations?.upsertAttempt &&
      convexMutations?.recordTelemetryEvents
    ) {
      telemetryTracker.setCloudSink({
        upsertAttempt: (attempt) => convexMutations.upsertAttempt(attempt),
        recordEvents: async (events) => {
          for (let i = 0; i < events.length; i += 100) {
            await convexMutations.recordTelemetryEvents({
              events: events.slice(i, i + 100),
            });
          }
        },
        discardAttempt: (attemptId) =>
          convexMutations.discardTelemetryAttempt
            ? convexMutations.discardTelemetryAttempt({ attemptId })
            : Promise.resolve(false),
      });
    } else {
      telemetryTracker.setCloudSink(null);
    }
    return () => {
      telemetryTracker.setCloudSink(null);
    };
  }, [isConvexConfigured, isEffectiveAuthenticated, convexMutations]);

  // Send backup payloads to Convex in bounded chunks (<= 400 items per mutation)
  const syncBackupToConvexChunked = useCallback(
    async (
      mode: 'merge' | 'replace',
      tagsToSync: Array<{ id?: string; name: string; color: string; isArchived?: boolean }>,
      sessionsToSync: Array<{
        id?: string;
        tagId?: string | null;
        sessionType: 'WORK' | 'SHORT_BREAK' | 'LONG_BREAK';
        durationSeconds: number;
        completedAt: string;
      }>,
      cupsToSync: Array<{
        id?: string;
        date: string;
        tagId?: string | null;
        createdAt?: string;
      }>,
      mlTelemetryToSync?: MlTelemetryExport
    ) => {
      const cleanSessions = sessionsToSync.filter((s) => !isSampleSessionId(s.id));
      const cleanCups = cupsToSync.filter((c) => !isSampleSessionId(c.id));
      const cleanAttempts = (mlTelemetryToSync?.sessionAttempts ?? []).filter(
        (a) => !isSampleSessionId(a.attemptId)
      );
      const cleanEvents = (mlTelemetryToSync?.events ?? []).filter(
        (e) => !isSampleSessionId(e.eventId)
      );

      const maxChunks = Math.max(
        1,
        Math.ceil(cleanSessions.length / BACKUP_CHUNK_SIZE),
        Math.ceil(cleanCups.length / BACKUP_CHUNK_SIZE),
        Math.ceil(cleanAttempts.length / TELEMETRY_ATTEMPT_CHUNK_SIZE),
        Math.ceil(cleanEvents.length / TELEMETRY_EVENT_CHUNK_SIZE)
      );

      for (let i = 0; i < maxChunks; i++) {
        const chunkMode = i === 0 ? mode : 'merge';
        const sessionSlice = cleanSessions.slice(
          i * BACKUP_CHUNK_SIZE,
          (i + 1) * BACKUP_CHUNK_SIZE
        );
        const cupSlice = cleanCups.slice(
          i * BACKUP_CHUNK_SIZE,
          (i + 1) * BACKUP_CHUNK_SIZE
        );
        const attemptSlice = cleanAttempts.slice(
          i * TELEMETRY_ATTEMPT_CHUNK_SIZE,
          (i + 1) * TELEMETRY_ATTEMPT_CHUNK_SIZE
        );
        const eventSlice = cleanEvents.slice(
          i * TELEMETRY_EVENT_CHUNK_SIZE,
          (i + 1) * TELEMETRY_EVENT_CHUNK_SIZE
        );

        const hasMlSlice = attemptSlice.length > 0 || eventSlice.length > 0;

        await convexMutations.importBackup({
          mode: chunkMode,
          tags: i === 0 ? tagsToSync : [],
          sessions: sessionSlice,
          coffeeCups: cupSlice,
          ...(hasMlSlice
            ? {
                mlTelemetry: {
                  schemaVersion: mlTelemetryToSync?.schemaVersion ?? 1,
                  sessionAttempts: attemptSlice,
                  events: eventSlice,
                },
              }
            : {}),
        });
      }
    },
    [convexMutations]
  );

  // Background migration of local offline data to Convex upon first login/load
  useEffect(() => {
    if (!isEffectiveAuthenticated || !isConvexConfigured) {
      hasMigratedToCloudRef.current = false;
      return;
    }

    if (hasMigratedToCloudRef.current) return;
    if (convexUser === undefined || convexSessions === undefined || convexCoffee === undefined) {
      return;
    }

    hasMigratedToCloudRef.current = true;

    (async () => {
      try {
        const [localSessions, localCoffee, localTags, localTelemetry] = await Promise.all([
          sessionRepository.purgeSampleSessions(),
          coffeeRepository.getAll(),
          tagRepository.getAll(),
          telemetryTracker.getExportData(),
        ]);

        const remoteSessionTimes = Array.isArray(convexSessions)
          ? convexSessions.map((s) => ({
              sessionType: s.sessionType,
              completedAt: s.completedAt,
              ms: new Date(s.completedAt).getTime(),
            }))
          : [];
        const missingSessions = Array.isArray(convexSessions)
          ? localSessions.filter((s) => {
              if (isSampleSessionId(s.id)) {
                return false;
              }
              const sMs = new Date(s.completedAt).getTime();
              return !remoteSessionTimes.some(
                (r) =>
                  r.completedAt === s.completedAt ||
                  (r.sessionType === s.sessionType &&
                    !isNaN(sMs) &&
                    !isNaN(r.ms) &&
                    Math.abs(r.ms - sMs) <= 45000)
              );
            })
          : [];

        const remoteCupTimes = new Set(
          Array.isArray(convexCoffee) ? convexCoffee.map((c) => c.createdAt) : []
        );
        const missingCups = Array.isArray(convexCoffee)
          ? localCoffee.filter((c) => !isSampleSessionId(c.id) && !remoteCupTimes.has(c.createdAt))
          : [];

        const remoteTagByName = new Map(
          (convexUser?.tags || []).map((t) => [t.name.toLowerCase().trim(), t.id])
        );
        const remoteTagIds = new Set((convexUser?.tags || []).map((t) => t.id));
        const localTagIdRemap = new Map<string, string>();
        const sanitizedLocalTags = localTags.map((t) => {
          const remoteId = remoteTagByName.get(t.name.toLowerCase().trim());
          if (remoteId) {
            localTagIdRemap.set(t.id, remoteId);
            return { ...t, id: remoteId };
          }
          const validId =
            typeof t.id === 'string' && TAG_ID_REGEX.test(t.id.trim())
              ? t.id.trim()
              : `tag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          localTagIdRemap.set(t.id, validId);
          return { ...t, id: validId };
        });

        const missingTags = sanitizedLocalTags.filter(
          (t) => !remoteTagByName.has(t.name.toLowerCase().trim())
        );

        const resolveMigratedTagId = (rawTagId?: string | null): string | undefined => {
          if (!rawTagId) return undefined;
          const mapped = localTagIdRemap.get(rawTagId) ?? rawTagId;
          if (
            TAG_ID_REGEX.test(mapped) &&
            (remoteTagIds.has(mapped) || missingTags.some((t) => t.id === mapped))
          ) {
            return mapped;
          }
          return undefined;
        };

        const convexUserId =
          convexUser?.id ?? (convexUser as { _id?: string } | null | undefined)?._id;
        const lastHydratedDate = convexUserId
          ? readHydrationWatermark(convexUserId)
          : null;
        const hasLocalTelemetry =
          localTelemetry.sessionAttempts.length > 0 || localTelemetry.events.length > 0;
        let incrementalStartDate =
          lastHydratedDate && hasLocalTelemetry
            ? shiftDateDays(lastHydratedDate, -1)
            : null;
        const telemetryQueryOptions = incrementalStartDate
          ? { limit: 500, startDate: incrementalStartDate }
          : { limit: 5000 };

        let [remoteAttemptsRaw, remoteEventsRaw] = await Promise.all([
          fetchTelemetryAttempts
            ? fetchTelemetryAttempts(telemetryQueryOptions)
            : Promise.resolve(null),
          fetchTelemetryEvents
            ? fetchTelemetryEvents(telemetryQueryOptions)
            : Promise.resolve(null),
        ]);
        let remoteAttempts = Array.isArray(remoteAttemptsRaw)
          ? (remoteAttemptsRaw as SessionAttempt[])
          : [];
        let remoteEvents = Array.isArray(remoteEventsRaw)
          ? (remoteEventsRaw as MlEvent[])
          : [];

        if (
          incrementalStartDate &&
          (remoteAttempts.length >= telemetryQueryOptions.limit ||
            remoteEvents.length >= telemetryQueryOptions.limit)
        ) {
          incrementalStartDate = null;
          [remoteAttemptsRaw, remoteEventsRaw] = await Promise.all([
            fetchTelemetryAttempts
              ? fetchTelemetryAttempts({ limit: 5000 })
              : Promise.resolve(null),
            fetchTelemetryEvents
              ? fetchTelemetryEvents({ limit: 5000 })
              : Promise.resolve(null),
          ]);
          remoteAttempts = Array.isArray(remoteAttemptsRaw)
            ? (remoteAttemptsRaw as SessionAttempt[])
            : [];
          remoteEvents = Array.isArray(remoteEventsRaw)
            ? (remoteEventsRaw as MlEvent[])
            : [];
        }

        const remoteAttemptIds = new Set(remoteAttempts.map((a) => a.attemptId));
        const remoteEventIds = new Set(remoteEvents.map((e) => e.eventId));

        const missingAttempts = localTelemetry.sessionAttempts
          .filter(
            (a) =>
              !isSampleSessionId(a.attemptId) &&
              (!incrementalStartDate || a.localDate >= incrementalStartDate) &&
              !remoteAttemptIds.has(a.attemptId)
          )
          .map((a) => ({
            ...a,
            initialTagId: resolveMigratedTagId(a.initialTagId) ?? null,
            tagId: resolveMigratedTagId(a.tagId) ?? null,
          }));
        const missingEvents = localTelemetry.events
          .filter(
            (e) =>
              !isSampleSessionId(e.eventId) &&
              (!incrementalStartDate || e.localDate >= incrementalStartDate) &&
              !remoteEventIds.has(e.eventId)
          )
          .map((e) => ({
            ...e,
            tagId: resolveMigratedTagId(e.tagId) ?? null,
            fromTagId: resolveMigratedTagId(e.fromTagId) ?? null,
            toTagId: resolveMigratedTagId(e.toTagId) ?? null,
          }));

        if (
          missingSessions.length > 0 ||
          missingCups.length > 0 ||
          missingTags.length > 0 ||
          missingAttempts.length > 0 ||
          missingEvents.length > 0
        ) {
          await syncBackupToConvexChunked(
            'merge',
            sanitizedLocalTags.map((t) => ({
              id: t.id,
              name: t.name,
              color: t.color,
              isArchived: t.isArchived,
            })),
            missingSessions.map((s) => ({
              id: s.id,
              tagId: resolveMigratedTagId(s.tagId),
              sessionType: s.sessionType,
              durationSeconds: s.durationSeconds,
              completedAt: s.completedAt,
            })),
            missingCups.map((c) => ({
              id: c.id,
              date: c.date,
              tagId: resolveMigratedTagId(c.tagId),
              createdAt: c.createdAt,
            })),
            missingAttempts.length > 0 || missingEvents.length > 0
              ? {
                  schemaVersion: 1,
                  sessionAttempts: missingAttempts,
                  events: missingEvents,
                }
              : undefined
          );
        }

        if (remoteAttempts.length > 0 || remoteEvents.length > 0) {
          await telemetryTracker.importTelemetry(
            {
              schemaVersion: 1,
              sessionAttempts: remoteAttempts,
              events: remoteEvents,
            },
            'merge'
          );
        }

        if (
          convexUserId &&
          Array.isArray(remoteAttemptsRaw) &&
          Array.isArray(remoteEventsRaw)
        ) {
          writeHydrationWatermark(convexUserId, buildLocalTimeContext().localDate);
        }
      } catch (err) {
        console.warn('Initial local-to-Convex migration check failed', err);
      }
    })();
  }, [
    isEffectiveAuthenticated,
    isConvexConfigured,
    convexUser,
    convexSessions,
    convexCoffee,
    fetchTelemetryAttempts,
    fetchTelemetryEvents,
    syncBackupToConvexChunked,
  ]);

  return {
    syncBackupToConvexChunked,
  };
}

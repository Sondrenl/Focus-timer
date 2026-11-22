import { useState, useEffect, useCallback, useRef } from 'react';
import { isSampleSessionId } from '../../services/repository/SessionRepository';
import {
  tagRepository,
  sessionRepository,
  coffeeRepository,
  settingsRepository,
  profileRepository,
  telemetryTracker,
} from '../../context/services';
import {
  MlEvent,
  MlTelemetryExport,
  SessionAttempt,
} from '../../types/telemetry';
import { DEFAULT_TAGS, Tag } from '../../types/tag';
import { DEFAULT_SETTINGS, UserSettings } from '../../types/settings';
import { DEFAULT_PROFILE, UserProfile } from '../../types/user';
import { useAuthProfile } from '../../context/AuthProfileContext';
import { buildLocalTimeContext } from '../../utils/telemetryContext';
import {
  TAG_ID_REGEX,
  clearAllHydrationWatermarks,
  readHydrationWatermark,
  shiftDateDays,
  writeHydrationWatermark,
} from '../../utils/backupSanitizers';
import {
  OutboxOperation,
  clearGuestDataModifiedFlag,
  clearOfflineOutbox,
  enqueueOutboxOperation,
  getLocalDataOwner,
  getLocalDataOwnerUserId,
  hasGuestDataBeenModified,
  readOfflineOutbox,
  removeOutboxOperation,
  setLocalDataOwner,
  subscribeLocalDataOwnerChange,
  subscribeOutboxChange,
} from '../../services/sync/offlineOutbox';

const BACKUP_CHUNK_SIZE = 400;
const TELEMETRY_ATTEMPT_CHUNK_SIZE = 400;
const TELEMETRY_EVENT_CHUNK_SIZE = 800;

export interface GuestReconciliationSummary {
  sessionsCount: number;
  coffeeCount: number;
  customTagsCount: number;
  hasCustomSettings: boolean;
  hasCustomProfile: boolean;
}

export interface PendingGuestReconciliation {
  summary: GuestReconciliationSummary;
  isResolving: boolean;
  error: string | null;
  resolve: (choice: 'merge' | 'discard') => Promise<void>;
}

const DEFAULT_TAG_BY_ID = new Map(DEFAULT_TAGS.map((t) => [t.id, t]));

function isUntouchedDefaultTag(tag: Tag): boolean {
  const def = DEFAULT_TAG_BY_ID.get(tag.id);
  if (!def) return false;
  return (
    def.name.trim().toLowerCase() === tag.name.trim().toLowerCase() &&
    def.color.trim().toLowerCase() === tag.color.trim().toLowerCase() &&
    Boolean(tag.isArchived) === Boolean(def.isArchived)
  );
}

function areTagsDefault(tags: Tag[] | undefined | null): boolean {
  if (!Array.isArray(tags) || tags.length !== DEFAULT_TAGS.length) return false;
  return tags.every((t) => isUntouchedDefaultTag(t));
}

function countCustomOrModifiedTags(tags: Tag[]): number {
  let count = 0;
  for (const tag of tags) {
    if (!isUntouchedDefaultTag(tag)) {
      count += 1;
    }
  }
  return count;
}

function extractCustomGuestSettings(
  localSettings: UserSettings
): Partial<
  Pick<
    UserSettings,
    | 'workDurationMinutes'
    | 'shortBreakDurationMinutes'
    | 'longBreakDurationMinutes'
    | 'longBreakInterval'
    | 'autoStartBreaks'
    | 'autoStartPomodoros'
    | 'soundVolume'
    | 'soundEnabled'
    | 'keepAwake'
  >
> {
  const patch: Partial<
    Pick<
      UserSettings,
      | 'workDurationMinutes'
      | 'shortBreakDurationMinutes'
      | 'longBreakDurationMinutes'
      | 'longBreakInterval'
      | 'autoStartBreaks'
      | 'autoStartPomodoros'
      | 'soundVolume'
      | 'soundEnabled'
      | 'keepAwake'
    >
  > = {};

  if (localSettings.workDurationMinutes !== DEFAULT_SETTINGS.workDurationMinutes) {
    patch.workDurationMinutes = localSettings.workDurationMinutes;
  }
  if (localSettings.shortBreakDurationMinutes !== DEFAULT_SETTINGS.shortBreakDurationMinutes) {
    patch.shortBreakDurationMinutes = localSettings.shortBreakDurationMinutes;
  }
  if (localSettings.longBreakDurationMinutes !== DEFAULT_SETTINGS.longBreakDurationMinutes) {
    patch.longBreakDurationMinutes = localSettings.longBreakDurationMinutes;
  }
  if (localSettings.longBreakInterval !== DEFAULT_SETTINGS.longBreakInterval) {
    patch.longBreakInterval = localSettings.longBreakInterval;
  }
  if (localSettings.autoStartBreaks !== DEFAULT_SETTINGS.autoStartBreaks) {
    patch.autoStartBreaks = localSettings.autoStartBreaks;
  }
  if (localSettings.autoStartPomodoros !== DEFAULT_SETTINGS.autoStartPomodoros) {
    patch.autoStartPomodoros = localSettings.autoStartPomodoros;
  }
  if (localSettings.soundVolume !== DEFAULT_SETTINGS.soundVolume) {
    patch.soundVolume = localSettings.soundVolume;
  }
  if (localSettings.soundEnabled !== DEFAULT_SETTINGS.soundEnabled) {
    patch.soundEnabled = localSettings.soundEnabled;
  }
  if (Boolean(localSettings.keepAwake) !== Boolean(DEFAULT_SETTINGS.keepAwake)) {
    patch.keepAwake = Boolean(localSettings.keepAwake);
  }
  return patch;
}

function extractCustomGuestProfile(localProfile: UserProfile): {
  displayName?: string;
  avatarEmoji?: string;
  dailyGoalMinutes?: number;
} {
  const patch: {
    displayName?: string;
    avatarEmoji?: string;
    dailyGoalMinutes?: number;
  } = {};

  if (
    localProfile.displayName &&
    localProfile.displayName.trim() !== DEFAULT_PROFILE.displayName
  ) {
    patch.displayName = localProfile.displayName.trim();
  }
  if (
    localProfile.avatarEmoji &&
    localProfile.avatarEmoji.trim() !== DEFAULT_PROFILE.avatarEmoji
  ) {
    patch.avatarEmoji = localProfile.avatarEmoji.trim();
  }
  if (localProfile.dailyGoalMinutes !== DEFAULT_PROFILE.dailyGoalMinutes) {
    patch.dailyGoalMinutes = localProfile.dailyGoalMinutes;
  }
  return patch;
}

function isPermanentOutboxError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return (
    msg.includes('Tag not found') ||
    msg.includes('already exists') ||
    msg.includes('Cannot exceed maximum limit') ||
    msg.includes('Maximum limit') ||
    msg.includes('Invalid ') ||
    msg.includes('cannot be in the future')
  );
}

interface UseCloudMigrationParams {
  isEffectiveAuthenticated: boolean;
  isConvexAuthReady?: boolean;
  convexSync: ReturnType<typeof useAuthProfile>['convexSync'];
  registerFullSyncHandler?: ReturnType<typeof useAuthProfile>['registerFullSyncHandler'];
  setActiveTagId?: (id: string | null, options?: { skipTelemetry?: boolean }) => void;
}

export function useCloudMigration({
  isEffectiveAuthenticated,
  isConvexAuthReady: isConvexAuthReadyParam,
  convexSync,
  registerFullSyncHandler,
  setActiveTagId,
}: UseCloudMigrationParams) {
  const isConvexAuthReady = isConvexAuthReadyParam ?? isEffectiveAuthenticated;
  const {
    isConvexConfigured,
    isConvexConnected,
    convexUser,
    convexCoffee,
    convexSessions,
    fetchTelemetryAttempts,
    fetchTelemetryEvents,
    mutations: convexMutations,
  } = convexSync;

  const convexUserId = convexUser?.id ?? null;

  const [syncedUserId, setSyncedUserId] = useState<string | null>(null);
  const [isFlushingOutbox, setIsFlushingOutbox] = useState(false);
  const [pendingGuestReconciliation, setPendingGuestReconciliation] =
    useState<PendingGuestReconciliation | null>(null);
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(() => {
    const ownerId = getLocalDataOwnerUserId();
    return ownerId ? readOfflineOutbox(ownerId).length : 0;
  });

  const isFlushingOutboxRef = useRef<boolean>(false);
  const isReconcilingUserIdRef = useRef<string | null>(null);
  const isConvexConnectedRef = useRef<boolean>(isConvexConnected);
  isConvexConnectedRef.current = isConvexConnected;
  const wasConnectedRef = useRef<boolean>(isConvexConnected);

  const getActiveOwnerUserId = useCallback((): string | null => {
    return convexUserId ?? getLocalDataOwnerUserId();
  }, [convexUserId]);

  // Keep reactive pendingSyncCount updated whenever the outbox or active user changes
  useEffect(() => {
    const refreshCount = () => {
      if (!isEffectiveAuthenticated) {
        setPendingSyncCount(0);
        return;
      }
      const ownerId = convexUserId ?? getLocalDataOwnerUserId();
      setPendingSyncCount(ownerId ? readOfflineOutbox(ownerId).length : 0);
    };
    refreshCount();
    const unsubOutbox = subscribeOutboxChange(refreshCount);
    const unsubOwner = subscribeLocalDataOwnerChange(refreshCount);
    return () => {
      unsubOutbox();
      unsubOwner();
    };
  }, [isEffectiveAuthenticated, convexUserId]);

  // Bind passive ML telemetry cloud sink with offline outbox durability (3A + M10)
  useEffect(() => {
    if (
      isConvexConfigured &&
      isEffectiveAuthenticated &&
      convexMutations?.upsertAttempt &&
      convexMutations?.recordTelemetryEvents
    ) {
      telemetryTracker.setCloudSink({
        upsertAttempt: async (attempt) => {
          const ownerId = getActiveOwnerUserId();
          const queuedOp = ownerId
            ? enqueueOutboxOperation(ownerId, {
                kind: 'upsert_telemetry_attempt',
                payload: attempt,
              })
            : null;
          if (!isConvexAuthReady || !isConvexConnectedRef.current) {
            return;
          }
          try {
            await convexMutations.upsertAttempt(attempt);
            if (queuedOp) removeOutboxOperation(queuedOp.id);
          } catch (err) {
            // Keep queuedOp in persistent outbox for reconnect replay
            throw err;
          }
        },
        recordEvents: async (events) => {
          if (events.length === 0) return;
          const ownerId = getActiveOwnerUserId();
          const queuedOp = ownerId
            ? enqueueOutboxOperation(ownerId, {
                kind: 'record_telemetry_events',
                payload: { events },
              })
            : null;
          if (!isConvexAuthReady || !isConvexConnectedRef.current) {
            return;
          }
          try {
            for (let i = 0; i < events.length; i += 100) {
              await convexMutations.recordTelemetryEvents({
                events: events.slice(i, i + 100),
              });
            }
            if (queuedOp) removeOutboxOperation(queuedOp.id);
          } catch (err) {
            throw err;
          }
        },
        discardAttempt: async (attemptId) => {
          const ownerId = getActiveOwnerUserId();
          const queuedOp = ownerId
            ? enqueueOutboxOperation(ownerId, {
                kind: 'discard_telemetry_attempt',
                payload: { attemptId },
              })
            : null;
          if (!isConvexAuthReady || !isConvexConnectedRef.current) {
            return false;
          }
          try {
            const res = convexMutations.discardTelemetryAttempt
              ? await convexMutations.discardTelemetryAttempt({ attemptId })
              : false;
            if (queuedOp) removeOutboxOperation(queuedOp.id);
            return res;
          } catch (err) {
            throw err;
          }
        },
      });
    } else {
      telemetryTracker.setCloudSink(null);
    }
    return () => {
      telemetryTracker.setCloudSink(null);
    };
  }, [
    isConvexConfigured,
    isEffectiveAuthenticated,
    isConvexAuthReady,
    convexMutations,
    getActiveOwnerUserId,
  ]);

  // Send backup payloads to Convex in bounded chunks (<= 400 items per mutation)
  const syncBackupToConvexChunked = useCallback(
    async (
      mode: 'merge' | 'replace',
      tagsToSync: Array<{
        id?: string;
        name: string;
        color: string;
        isArchived?: boolean;
        createdAt?: string;
        updatedAt?: string;
      }>,
      sessionsToSync: Array<{
        id?: string;
        tagId?: string | null;
        sessionType: 'WORK' | 'SHORT_BREAK' | 'LONG_BREAK';
        durationSeconds: number;
        completedAt: string;
        timerRunId?: string | null;
      }>,
      cupsToSync: Array<{
        id?: string;
        date: string;
        tagId?: string | null;
        createdAt?: string;
      }>,
      mlTelemetryToSync?: MlTelemetryExport,
      options?: { skipPreClear?: boolean }
    ) => {
      const cleanSessions = sessionsToSync.filter((s) => !isSampleSessionId(s.id));
      const cleanCups = cupsToSync.filter((c) => !isSampleSessionId(c.id));
      const cleanAttempts = (mlTelemetryToSync?.sessionAttempts ?? []).filter(
        (a) => !isSampleSessionId(a.attemptId)
      );
      const cleanEvents = (mlTelemetryToSync?.events ?? []).filter(
        (e) => !isSampleSessionId(e.eventId)
      );

      let didPreClear = Boolean(options?.skipPreClear);
      if (
        mode === 'replace' &&
        !options?.skipPreClear &&
        typeof convexMutations.clearForReplaceBatch === 'function'
      ) {
        let hasMore = true;
        let batches = 0;
        const MAX_CLEAR_BATCHES = 500;
        while (hasMore && batches < MAX_CLEAR_BATCHES) {
          const res = await convexMutations.clearForReplaceBatch({});
          hasMore = Boolean(res?.hasMore);
          batches += 1;
        }
        didPreClear = true;
      }

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
          ...(i === 0 && didPreClear ? { skipReplaceClear: true } : {}),
          tags: i === 0 || chunkMode === 'merge' ? tagsToSync : [],
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

  // Replay persistent offline outbox operations in order for a given userId (Decision 3A)
  const flushOfflineOutbox = useCallback(
    async (ownerUserId: string): Promise<{ flushed: number; remaining: number }> => {
      if (!ownerUserId || !isConvexConfigured || !isConvexAuthReady) {
        return { flushed: 0, remaining: readOfflineOutbox(ownerUserId).length };
      }
      if (!isConvexConnectedRef.current) {
        return { flushed: 0, remaining: readOfflineOutbox(ownerUserId).length };
      }
      if (isFlushingOutboxRef.current) {
        return { flushed: 0, remaining: readOfflineOutbox(ownerUserId).length };
      }

      const ops = readOfflineOutbox(ownerUserId);
      if (ops.length === 0) {
        return { flushed: 0, remaining: 0 };
      }

      isFlushingOutboxRef.current = true;
      setIsFlushingOutbox(true);
      let flushed = 0;

      const executeOp = async (op: OutboxOperation) => {
        switch (op.kind) {
          case 'reset_all': {
            await convexMutations.clearSessions({});
            await convexMutations.clearCoffee({});
            if (convexMutations.clearTelemetry) {
              await convexMutations.clearTelemetry({});
            }
            if (op.payload.scope === 'factory-reset') {
              await convexMutations.resetTags({});
            }
            return;
          }
          case 'create_tag': {
            await convexMutations.createTag({
              id: op.payload.id,
              name: op.payload.name,
              color: op.payload.color,
            });
            return;
          }
          case 'update_tag': {
            await convexMutations.updateTag({
              id: op.payload.id,
              name: op.payload.name,
              color: op.payload.color,
              isArchived: op.payload.isArchived,
            });
            return;
          }
          case 'remove_tag': {
            await convexMutations.removeTag({ id: op.payload.id });
            return;
          }
          case 'record_session': {
            const serverSession = await convexMutations.recordSession({
              tagId: op.payload.tagId,
              sessionType: op.payload.sessionType,
              durationSeconds: op.payload.durationSeconds,
              completedAt: op.payload.completedAt,
              timerRunId: op.payload.timerRunId,
            });
            if (serverSession?.id) {
              await sessionRepository.replaceId(op.payload.localId, serverSession.id, {
                completedAt: serverSession.completedAt,
              });
            }
            return;
          }
          case 'add_coffee': {
            const serverCup = await convexMutations.addCup({
              date: op.payload.date,
              tagId: op.payload.tagId,
              createdAt: op.payload.createdAt,
            });
            if (serverCup?.id) {
              await coffeeRepository.replaceId(op.payload.localId, serverCup.id);
              await telemetryTracker.reconcileCoffeeCupId(op.payload.localId, serverCup.id);
            }
            return;
          }
          case 'remove_coffee': {
            await convexMutations.removeCup({
              id: op.payload.id,
              date: op.payload.date,
              tagId: op.payload.tagId,
            });
            return;
          }
          case 'update_settings': {
            await convexMutations.updateSettings(op.payload);
            return;
          }
          case 'update_profile': {
            await convexMutations.updateProfile(op.payload);
            return;
          }
          case 'upsert_telemetry_attempt': {
            if (convexMutations.upsertAttempt) {
              await convexMutations.upsertAttempt(op.payload);
            }
            return;
          }
          case 'discard_telemetry_attempt': {
            if (convexMutations.discardTelemetryAttempt) {
              await convexMutations.discardTelemetryAttempt({
                attemptId: op.payload.attemptId,
              });
            }
            return;
          }
          case 'record_telemetry_events': {
            if (convexMutations.recordTelemetryEvents) {
              const evts = op.payload.events;
              for (let i = 0; i < evts.length; i += 100) {
                await convexMutations.recordTelemetryEvents({
                  events: evts.slice(i, i + 100),
                });
              }
            }
            return;
          }
        }
      };

      try {
        for (const op of ops) {
          try {
            await executeOp(op);
            removeOutboxOperation(op.id);
            flushed += 1;
          } catch (err) {
            if (isPermanentOutboxError(err)) {
              console.warn(`Dropping permanently invalid outbox op (${op.kind}):`, err);
              removeOutboxOperation(op.id);
              continue;
            }
            console.warn(`Paused outbox replay on transient error (${op.kind}):`, err);
            break;
          }
        }
      } finally {
        isFlushingOutboxRef.current = false;
        setIsFlushingOutbox(false);
      }

      return { flushed, remaining: readOfflineOutbox(ownerUserId).length };
    },
    [isConvexConfigured, isConvexAuthReady, convexMutations]
  );

  // Hydrate remote ML telemetry into local repository and upgrade any remote in_progress attempts
  // that were finalized locally while offline (M10)
  const hydrateRemoteTelemetry = useCallback(
    async (userId: string) => {
      if (!fetchTelemetryAttempts || !fetchTelemetryEvents) return;

      const localTelemetry = await telemetryTracker.getExportData();
      const lastHydratedDate = readHydrationWatermark(userId);
      const hasLocalTelemetry =
        localTelemetry.sessionAttempts.length > 0 || localTelemetry.events.length > 0;
      let incrementalStartDate =
        lastHydratedDate && hasLocalTelemetry ? shiftDateDays(lastHydratedDate, -1) : null;
      const telemetryQueryOptions = incrementalStartDate
        ? { limit: 500, startDate: incrementalStartDate }
        : { limit: 5000 };

      let [remoteAttemptsRaw, remoteEventsRaw] = await Promise.all([
        fetchTelemetryAttempts(telemetryQueryOptions),
        fetchTelemetryEvents(telemetryQueryOptions),
      ]);

      // Abort cleanly if either fetch returned null (e.g. auth unavailable or network failure)
      if (!Array.isArray(remoteAttemptsRaw) || !Array.isArray(remoteEventsRaw)) {
        return;
      }

      let remoteAttempts = remoteAttemptsRaw as SessionAttempt[];
      let remoteEvents = remoteEventsRaw as MlEvent[];

      if (
        incrementalStartDate &&
        (remoteAttempts.length >= telemetryQueryOptions.limit ||
          remoteEvents.length >= telemetryQueryOptions.limit)
      ) {
        incrementalStartDate = null;
        [remoteAttemptsRaw, remoteEventsRaw] = await Promise.all([
          fetchTelemetryAttempts({ limit: 5000 }),
          fetchTelemetryEvents({ limit: 5000 }),
        ]);
        if (!Array.isArray(remoteAttemptsRaw) || !Array.isArray(remoteEventsRaw)) {
          return;
        }
        remoteAttempts = remoteAttemptsRaw as SessionAttempt[];
        remoteEvents = remoteEventsRaw as MlEvent[];
      }

      // Upgrade any remote attempt still stuck in `in_progress` if local has a finalized version
      if (convexMutations.upsertAttempt && localTelemetry.sessionAttempts.length > 0) {
        const remoteByAttemptId = new Map(remoteAttempts.map((a) => [a.attemptId, a]));
        for (const localAttempt of localTelemetry.sessionAttempts) {
          if (isSampleSessionId(localAttempt.attemptId)) continue;
          const remote = remoteByAttemptId.get(localAttempt.attemptId);
          if (
            remote &&
            remote.status === 'in_progress' &&
            localAttempt.status !== 'in_progress'
          ) {
            try {
              await convexMutations.upsertAttempt(localAttempt);
            } catch (err) {
              console.warn('Failed to upgrade in_progress remote attempt:', err);
            }
          }
        }
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

      writeHydrationWatermark(userId, buildLocalTimeContext().localDate);
    },
    [fetchTelemetryAttempts, fetchTelemetryEvents, convexMutations]
  );

  // Register full sync handler for the Profile "Sync Now" button (M8 + 3A)
  useEffect(() => {
    if (!registerFullSyncHandler) return;
    const unregister = registerFullSyncHandler(async () => {
      if (!convexUserId || !isConvexAuthReady) return;
      await flushOfflineOutbox(convexUserId);
      await hydrateRemoteTelemetry(convexUserId);
    });
    return unregister;
  }, [
    registerFullSyncHandler,
    convexUserId,
    isConvexAuthReady,
    flushOfflineOutbox,
    hydrateRemoteTelemetry,
  ]);

  // Automatically replay offline outbox when WebSocket reconnects (false -> true)
  useEffect(() => {
    const prevConnected = wasConnectedRef.current;
    wasConnectedRef.current = isConvexConnected;
    if (
      !prevConnected &&
      isConvexConnected &&
      isConvexAuthReady &&
      convexUserId &&
      syncedUserId === convexUserId
    ) {
      void flushOfflineOutbox(convexUserId);
    }
  }, [isConvexConnected, isConvexAuthReady, convexUserId, syncedUserId, flushOfflineOutbox]);

  // Reset sync gate cleanly on logout or account switch
  useEffect(() => {
    if (!isEffectiveAuthenticated || !isConvexConfigured) {
      setSyncedUserId(null);
      setPendingGuestReconciliation(null);
      isReconcilingUserIdRef.current = null;
      return;
    }
    if (convexUserId && syncedUserId && syncedUserId !== convexUserId) {
      setSyncedUserId(null);
      setPendingGuestReconciliation(null);
      isReconcilingUserIdRef.current = null;
    }
  }, [isEffectiveAuthenticated, isConvexConfigured, convexUserId, syncedUserId]);

  // Primary ownership check, outbox replay, and 1A guest reconciliation gate
  useEffect(() => {
    if (
      !isEffectiveAuthenticated ||
      !isConvexConfigured ||
      !isConvexAuthReady ||
      !convexUser ||
      !Array.isArray(convexSessions) ||
      !Array.isArray(convexCoffee)
    ) {
      return;
    }

    const userId = convexUser.id;
    if (syncedUserId === userId || isReconcilingUserIdRef.current === userId) {
      return;
    }

    isReconcilingUserIdRef.current = userId;
    let cancelled = false;

    const runSyncGate = async () => {
      try {
        const owner = getLocalDataOwner();

        // Case A: Local cache belongs to a DIFFERENT signed-in account — wipe immediately (fixes C1)
        if (owner !== null && owner !== 'guest' && owner !== `user:${userId}`) {
          await Promise.all([
            sessionRepository.clear(),
            coffeeRepository.clear(),
            tagRepository.resetToDefaults(),
            telemetryTracker.clearAll(),
          ]);
          clearAllHydrationWatermarks();
          clearOfflineOutbox(owner.slice(5));
          clearGuestDataModifiedFlag();
          setLocalDataOwner(`user:${userId}`);
          await hydrateRemoteTelemetry(userId);
          if (!cancelled) {
            setSyncedUserId(userId);
          }
          return;
        }

        // Case B: Returning same user — NEVER re-diff stale cache (fixes C2 deletion resurrection).
        // Instead, replay only durable offline outbox mutations recorded since last sync (Decision 3A).
        if (owner === `user:${userId}`) {
          await flushOfflineOutbox(userId);
          await hydrateRemoteTelemetry(userId);
          if (!cancelled) {
            setSyncedUserId(userId);
          }
          return;
        }

        // Case C: Guest / first-time sign-in on this device (owner === 'guest' || owner === null)
        const [
          localSessions,
          localCoffee,
          localTags,
          localSettings,
          localProfile,
          localTelemetry,
        ] = await Promise.all([
          sessionRepository.purgeSampleSessions(),
          coffeeRepository.getAll(),
          tagRepository.getAll(),
          settingsRepository.get(),
          profileRepository.get(),
          telemetryTracker.getExportData(),
        ]);

        const cleanSessions = localSessions.filter((s) => !isSampleSessionId(s.id));
        const cleanCoffee = localCoffee.filter((c) => !isSampleSessionId(c.id));
        const cleanAttempts = localTelemetry.sessionAttempts.filter(
          (a) => !isSampleSessionId(a.attemptId)
        );
        const cleanEvents = localTelemetry.events.filter(
          (e) => !isSampleSessionId(e.eventId)
        );

        const customTagCount = countCustomOrModifiedTags(localTags);
        const tagsModifiedFromDefaults = !areTagsDefault(localTags);
        const customSettings = extractCustomGuestSettings(localSettings);
        const customProfile = extractCustomGuestProfile(localProfile);
        const hasCustomSettings = Object.keys(customSettings).length > 0;
        const hasCustomProfile = Object.keys(customProfile).length > 0;
        const guestModifiedFlag = hasGuestDataBeenModified();

        const hasGenuineGuestData =
          cleanSessions.length > 0 ||
          cleanCoffee.length > 0 ||
          tagsModifiedFromDefaults ||
          cleanAttempts.length > 0 ||
          cleanEvents.length > 0 ||
          (guestModifiedFlag && (hasCustomSettings || hasCustomProfile));

        // Subcase C1: No genuine guest data — adopt cloud cleanly
        if (!hasGenuineGuestData) {
          setLocalDataOwner(`user:${userId}`);
          await hydrateRemoteTelemetry(userId);
          if (!cancelled) {
            setSyncedUserId(userId);
          }
          return;
        }

        const remoteTags = Array.isArray(convexUser.tags)
          ? (convexUser.tags as Tag[])
          : DEFAULT_TAGS;
        const isBrandNewEmptyCloudAccount =
          convexSessions.length === 0 &&
          convexCoffee.length === 0 &&
          areTagsDefault(remoteTags);

        // Helper to upload guest data into the cloud account
        const uploadGuestData = async (strategy: 'new-account' | 'merge-existing') => {
          const referencedTagIds = new Set<string>();
          for (const s of cleanSessions) if (s.tagId) referencedTagIds.add(s.tagId);
          for (const c of cleanCoffee) if (c.tagId) referencedTagIds.add(c.tagId);
          for (const a of cleanAttempts) {
            if (a.tagId) referencedTagIds.add(a.tagId);
            if (a.initialTagId) referencedTagIds.add(a.initialTagId);
          }
          for (const e of cleanEvents) {
            if (e.tagId) referencedTagIds.add(e.tagId);
            if (e.fromTagId) referencedTagIds.add(e.fromTagId);
            if (e.toTagId) referencedTagIds.add(e.toTagId);
          }

          if (strategy === 'new-account') {
            // Brand-new account: faithfully preserve guest tag edits/deletions/archives,
            // plus non-default guest settings and profile customizations (H4 + H5).
            const tagMode: 'replace' | 'merge' = tagsModifiedFromDefaults ? 'replace' : 'merge';
            const tagsPayload = tagsModifiedFromDefaults
              ? localTags.map((t) => ({
                  id: t.id,
                  name: t.name,
                  color: t.color,
                  isArchived: t.isArchived,
                  createdAt: t.createdAt,
                  updatedAt: t.updatedAt,
                }))
              : [];

            await syncBackupToConvexChunked(
              tagMode,
              tagsPayload,
              cleanSessions.map((s) => ({
                id: s.id,
                tagId: s.tagId || undefined,
                sessionType: s.sessionType,
                durationSeconds: s.durationSeconds,
                completedAt: s.completedAt,
                timerRunId: s.timerRunId || undefined,
              })),
              cleanCoffee.map((c) => ({
                id: c.id,
                date: c.date,
                tagId: c.tagId || undefined,
                createdAt: c.createdAt,
              })),
              cleanAttempts.length > 0 || cleanEvents.length > 0
                ? {
                    schemaVersion: 1,
                    sessionAttempts: cleanAttempts,
                    events: cleanEvents,
                  }
                : undefined,
              { skipPreClear: true }
            );

            if (hasCustomSettings) {
              await convexMutations.updateSettings(customSettings);
            }
            if (hasCustomProfile) {
              await convexMutations.updateProfile(customProfile);
            }
            return;
          }

          // Merge into existing populated account:
          // Exclude untouched default tags that have no local references so we never resurrect
          // defaults the user deliberately deleted in their cloud account (H4).
          const remoteTagByName = new Map(
            remoteTags.map((t) => [t.name.toLowerCase().trim(), t.id])
          );
          const remoteTagIds = new Set(remoteTags.map((t) => t.id));
          const localTagIdRemap = new Map<string, string>();
          const tagsToMerge: Array<{
            id: string;
            name: string;
            color: string;
            isArchived: boolean;
            createdAt?: string;
            updatedAt?: string;
          }> = [];

          for (const t of localTags) {
            const nameKey = t.name.toLowerCase().trim();
            const matchedRemoteId = remoteTagByName.get(nameKey);
            if (matchedRemoteId) {
              localTagIdRemap.set(t.id, matchedRemoteId);
              continue;
            }
            // Skip untouched default tags that aren't referenced by any guest records
            if (isUntouchedDefaultTag(t) && !referencedTagIds.has(t.id)) {
              continue;
            }
            const validId =
              typeof t.id === 'string' &&
              TAG_ID_REGEX.test(t.id.trim()) &&
              !remoteTagIds.has(t.id.trim())
                ? t.id.trim()
                : `tag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            localTagIdRemap.set(t.id, validId);
            remoteTagIds.add(validId);
            tagsToMerge.push({
              id: validId,
              name: t.name,
              color: t.color,
              isArchived: t.isArchived,
              createdAt: t.createdAt,
              updatedAt: t.updatedAt,
            });
          }

          const resolveTagRef = (rawTagId?: string | null): string | undefined => {
            if (!rawTagId) return undefined;
            const mapped = localTagIdRemap.get(rawTagId) ?? rawTagId;
            return remoteTagIds.has(mapped) && TAG_ID_REGEX.test(mapped) ? mapped : undefined;
          };

          await syncBackupToConvexChunked(
            'merge',
            tagsToMerge,
            cleanSessions.map((s) => ({
              id: s.id,
              tagId: resolveTagRef(s.tagId),
              sessionType: s.sessionType,
              durationSeconds: s.durationSeconds,
              completedAt: s.completedAt,
              timerRunId: s.timerRunId || undefined,
            })),
            cleanCoffee.map((c) => ({
              id: c.id,
              date: c.date,
              tagId: resolveTagRef(c.tagId),
              createdAt: c.createdAt,
            })),
            cleanAttempts.length > 0 || cleanEvents.length > 0
              ? {
                  schemaVersion: 1,
                  sessionAttempts: cleanAttempts.map((a) => ({
                    ...a,
                    initialTagId: resolveTagRef(a.initialTagId) ?? null,
                    tagId: resolveTagRef(a.tagId) ?? null,
                  })),
                  events: cleanEvents.map((e) => ({
                    ...e,
                    tagId: resolveTagRef(e.tagId) ?? null,
                    fromTagId: resolveTagRef(e.fromTagId) ?? null,
                    toTagId: resolveTagRef(e.toTagId) ?? null,
                  })),
                }
              : undefined
          );

          // Remap locally selected activeTagId if it was remapped to a new or remote tag ID
          try {
            const currentActiveId = localStorage.getItem('active_tag_id_v1');
            if (currentActiveId && localTagIdRemap.has(currentActiveId) && setActiveTagId) {
              setActiveTagId(localTagIdRemap.get(currentActiveId) ?? null, {
                skipTelemetry: true,
              });
            }
          } catch {
            // Ignore storage errors
          }
        };

        // Subcase C2: Brand-new empty cloud account -> auto-migrate seamlessly!
        if (isBrandNewEmptyCloudAccount) {
          await uploadGuestData('new-account');
          setLocalDataOwner(`user:${userId}`);
          await hydrateRemoteTelemetry(userId);
          if (!cancelled) {
            setSyncedUserId(userId);
          }
          return;
        }

        // Subcase C3 (Decision 1A): Genuine guest data meets an existing populated cloud account!
        // Pause cloud adoption and prompt the user to choose Merge vs Discard Local.
        if (!cancelled) {
          const summary: GuestReconciliationSummary = {
            sessionsCount: cleanSessions.length,
            coffeeCount: cleanCoffee.length,
            customTagsCount: customTagCount,
            hasCustomSettings,
            hasCustomProfile,
          };

          const resolveChoice = async (choice: 'merge' | 'discard') => {
            setPendingGuestReconciliation((prev) =>
              prev ? { ...prev, isResolving: true, error: null } : prev
            );
            try {
              if (choice === 'merge') {
                await uploadGuestData('merge-existing');
              } else {
                await Promise.all([
                  sessionRepository.clear(),
                  coffeeRepository.clear(),
                  tagRepository.resetToDefaults(),
                  telemetryTracker.clearAll(),
                ]);
                clearAllHydrationWatermarks();
                clearGuestDataModifiedFlag();
              }
              setLocalDataOwner(`user:${userId}`);
              await hydrateRemoteTelemetry(userId);
              setPendingGuestReconciliation(null);
              setSyncedUserId(userId);
            } catch (err) {
              const msg =
                err instanceof Error ? err.message : 'Failed to complete account sync. Please try again.';
              setPendingGuestReconciliation((prev) =>
                prev ? { ...prev, isResolving: false, error: msg } : prev
              );
            }
          };

          setPendingGuestReconciliation({
            summary,
            isResolving: false,
            error: null,
            resolve: resolveChoice,
          });
        }
      } catch (err) {
        console.warn('Cloud reconciliation/sync gate failed (will retry):', err);
        // Reset ref so transient errors can be retried instead of permanently aborting (fixes C3)
        if (isReconcilingUserIdRef.current === userId) {
          isReconcilingUserIdRef.current = null;
        }
      }
    };

    void runSyncGate();

    return () => {
      cancelled = true;
    };
  }, [
    isEffectiveAuthenticated,
    isConvexConfigured,
    isConvexAuthReady,
    convexUser,
    convexSessions,
    convexCoffee,
    syncedUserId,
    convexMutations,
    flushOfflineOutbox,
    hydrateRemoteTelemetry,
    syncBackupToConvexChunked,
    setActiveTagId,
  ]);

  // Adoption is paused whenever authenticated + configured until initial sync gate clears,
  // while outbox replay is running, or while the 1A guest reconciliation modal is open.
  const isSyncGateActive =
    isEffectiveAuthenticated &&
    isConvexConfigured &&
    (isFlushingOutbox ||
      pendingGuestReconciliation !== null ||
      !convexUserId ||
      syncedUserId !== convexUserId);

  return {
    syncBackupToConvexChunked,
    flushOfflineOutbox,
    isSyncGateActive,
    pendingGuestReconciliation,
    pendingSyncCount,
  };
}

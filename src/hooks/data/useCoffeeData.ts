import { useState, useEffect, useCallback, useRef } from 'react';
import { CoffeeCup } from '../../types/coffee';
import {
  broadcastCoffeeCups,
  subscribeAuthEvent,
  subscribeCoffeeCups,
  subscribeReset,
} from '../../services/timer/TimerBroadcast';
import { toDateKey } from '../../utils/dates';
import { coffeeRepository, telemetryTracker } from '../../context/services';
import { useAuthProfile } from '../../context/AuthProfileContext';
import { TIMER_STORAGE_KEY } from '../../context/timer/timerPersistence';
import { SessionType, TimerStatus } from '../../types/timer';
import {
  enqueueOutboxOperation,
  getLocalDataOwnerUserId,
  markGuestDataModified,
  readOfflineOutbox,
  removeOutboxOperation,
} from '../../services/sync/offlineOutbox';

function readActiveTimerContext(): {
  status: TimerStatus | null;
  sessionType: SessionType | null;
} {
  if (typeof window === 'undefined') {
    return { status: null, sessionType: null };
  }
  try {
    const raw = localStorage.getItem(TIMER_STORAGE_KEY);
    if (!raw) return { status: null, sessionType: null };
    const parsed = JSON.parse(raw);
    const rawStatus: TimerStatus | null = parsed?.status ?? null;
    const targetEndTime =
      typeof parsed?.targetEndTime === 'number' ? parsed.targetEndTime : null;
    const status: TimerStatus | null =
      rawStatus === 'RUNNING' && targetEndTime !== null && targetEndTime <= Date.now()
        ? 'IDLE'
        : rawStatus;
    return {
      status,
      sessionType: parsed?.sessionType ?? null,
    };
  } catch {
    return { status: null, sessionType: null };
  }
}

interface UseCoffeeDataParams {
  isEffectiveAuthenticated: boolean;
  isConvexAuthReady: boolean;
  isAdoptionPaused: boolean;
  currentUserId: string | null;
  convexSync: ReturnType<typeof useAuthProfile>['convexSync'];
}

export function useCoffeeData({
  isEffectiveAuthenticated,
  isConvexAuthReady,
  isAdoptionPaused,
  currentUserId,
  convexSync,
}: UseCoffeeDataParams) {
  const {
    isConvexConfigured,
    isConvexConnected,
    convexCoffee,
    mutations: convexMutations,
  } = convexSync;

  const [coffeeCups, setCoffeeCups] = useState<CoffeeCup[]>([]);
  const coffeeCupsRef = useRef<CoffeeCup[]>(coffeeCups);
  coffeeCupsRef.current = coffeeCups;

  const pendingAddsRef = useRef<Map<string, CoffeeCup>>(new Map());
  const pendingDeletesRef = useRef<Set<string>>(new Set());
  const pendingDeletedCreatedAtRef = useRef<Map<string, number>>(new Map());
  const isConvexConnectedRef = useRef<boolean>(isConvexConnected);
  isConvexConnectedRef.current = isConvexConnected;

  const getActiveOwnerUserId = useCallback((): string | null => {
    return currentUserId ?? getLocalDataOwnerUserId();
  }, [currentUserId]);

  const addPendingDeletedCreatedAt = useCallback((createdAt: string) => {
    const count = pendingDeletedCreatedAtRef.current.get(createdAt) ?? 0;
    pendingDeletedCreatedAtRef.current.set(createdAt, count + 1);
  }, []);

  const removePendingDeletedCreatedAt = useCallback((createdAt: string) => {
    const count = pendingDeletedCreatedAtRef.current.get(createdAt) ?? 0;
    if (count <= 1) {
      pendingDeletedCreatedAtRef.current.delete(createdAt);
    } else {
      pendingDeletedCreatedAtRef.current.set(createdAt, count - 1);
    }
  }, []);

  // Clear pending cloud-reconciliation refs whenever signed out
  useEffect(() => {
    if (!isEffectiveAuthenticated) {
      pendingAddsRef.current.clear();
      pendingDeletesRef.current.clear();
      pendingDeletedCreatedAtRef.current.clear();
    }
  }, [isEffectiveAuthenticated]);

  // Initial load of coffee cups from local storage
  useEffect(() => {
    async function initCoffee() {
      const loadedCoffee = await coffeeRepository.getAll();
      coffeeCupsRef.current = loadedCoffee;
      setCoffeeCups(loadedCoffee);
    }

    initCoffee();
  }, []);

  // Reactive adoption of Convex coffee cups (paused during migration, outbox replay, and replace imports)
  useEffect(() => {
    if (!isConvexAuthReady || isAdoptionPaused || !Array.isArray(convexCoffee)) return;

    const ownerId = getActiveOwnerUserId();
    const outboxOps = ownerId ? readOfflineOutbox(ownerId) : [];

    // If a reset_all is pending in the offline outbox, preserve cleared local state until replayed
    if (outboxOps.some((op) => op.kind === 'reset_all')) {
      return;
    }

    const serverCups = convexCoffee as CoffeeCup[];
    const pendingDeletes = new Set<string>(pendingDeletesRef.current);
    const pendingDeletedCreatedAt = new Set<string>(pendingDeletedCreatedAtRef.current.keys());
    const pendingAddsMap = new Map<string, CoffeeCup>();

    for (const op of outboxOps) {
      if (op.kind === 'add_coffee') {
        pendingAddsMap.set(op.payload.localId, {
          id: op.payload.localId,
          date: op.payload.date,
          tagId: op.payload.tagId ?? null,
          createdAt: op.payload.createdAt,
        });
      } else if (op.kind === 'remove_coffee') {
        pendingDeletes.add(op.payload.id);
        pendingDeletedCreatedAt.add(op.payload.createdAt);
      }
    }
    for (const [id, cup] of pendingAddsRef.current.entries()) {
      pendingAddsMap.set(id, cup);
    }
    const pendingAdds = Array.from(pendingAddsMap.values());

    const remainingServer = serverCups.filter(
      (c) => !pendingDeletes.has(c.id) && !pendingDeletedCreatedAt.has(c.createdAt)
    );
    const serverIds = new Set(remainingServer.map((c) => c.id));
    const serverCreatedTimes = new Set(remainingServer.map((c) => c.createdAt));

    const unconfirmedAdds = pendingAdds.filter(
      (a) =>
        !pendingDeletes.has(a.id) &&
        !pendingDeletedCreatedAt.has(a.createdAt) &&
        !serverIds.has(a.id) &&
        !serverCreatedTimes.has(a.createdAt)
    );

    const merged = [...remainingServer, ...unconfirmedAdds].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    const prev = coffeeCupsRef.current;
    const isSame =
      prev.length === merged.length &&
      prev.every(
        (c, i) =>
          c.id === merged[i].id &&
          c.date === merged[i].date &&
          c.tagId === merged[i].tagId &&
          c.createdAt === merged[i].createdAt
      );

    if (!isSame) {
      coffeeCupsRef.current = merged;
      setCoffeeCups(merged);
      void coffeeRepository.saveAll(merged);
    }
  }, [convexCoffee, isConvexAuthReady, isAdoptionPaused, getActiveOwnerUserId]);

  // Multi-tab BroadcastChannel synchronization for coffee cups, resets, and logout
  useEffect(() => {
    const unsubCoffee = subscribeCoffeeCups((cups) => {
      // Sender tab already wrote localStorage; only update local React state
      coffeeCupsRef.current = cups;
      setCoffeeCups(cups);
    });

    const unsubReset = subscribeReset(() => {
      pendingAddsRef.current.clear();
      pendingDeletesRef.current.clear();
      pendingDeletedCreatedAtRef.current.clear();
      coffeeCupsRef.current = [];
      setCoffeeCups([]);
    });

    const unsubAuth = subscribeAuthEvent((payload) => {
      if (payload.action === 'logout') {
        pendingAddsRef.current.clear();
        pendingDeletesRef.current.clear();
        pendingDeletedCreatedAtRef.current.clear();
        coffeeCupsRef.current = [];
        setCoffeeCups([]);
      }
    });

    return () => {
      unsubCoffee();
      unsubReset();
      unsubAuth();
    };
  }, []);

  const addCoffeeCup = useCallback(
    async (tagId: string | null, dateStr?: string): Promise<CoffeeCup> => {
      const today = dateStr || toDateKey(new Date());
      const created = await coffeeRepository.addCup(today, tagId);
      if (!isEffectiveAuthenticated) {
        markGuestDataModified();
      }

      const shouldSyncToCloud = isConvexConfigured && isEffectiveAuthenticated;
      const ownerId = shouldSyncToCloud ? getActiveOwnerUserId() : null;
      const queuedOp = ownerId
        ? enqueueOutboxOperation(ownerId, {
            kind: 'add_coffee',
            payload: {
              localId: created.id,
              date: today,
              tagId: tagId || undefined,
              createdAt: created.createdAt,
            },
          })
        : null;

      if (shouldSyncToCloud) {
        pendingAddsRef.current.set(created.id, created);
      }

      const updated = await coffeeRepository.getAll();
      const sortedUpdated = [...updated].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      coffeeCupsRef.current = sortedUpdated;
      setCoffeeCups(sortedUpdated);
      broadcastCoffeeCups(sortedUpdated);

      const activeTimer = readActiveTimerContext();
      void telemetryTracker.onCoffeeLogged({
        cup: created,
        allCupsAfterAdd: sortedUpdated,
        timerStatus: activeTimer.status,
        activeSessionType: activeTimer.sessionType,
      });

      if (shouldSyncToCloud && isConvexAuthReady && isConvexConnectedRef.current) {
        convexMutations
          .addCup({
            date: today,
            tagId: tagId || undefined,
            createdAt: created.createdAt,
          })
          .then((serverCup) => {
            pendingAddsRef.current.delete(created.id);
            if (queuedOp) {
              removeOutboxOperation(queuedOp.id);
            }
            if (pendingDeletesRef.current.has(created.id)) {
              pendingDeletesRef.current.delete(created.id);
              if (serverCup && serverCup.id) {
                pendingDeletesRef.current.add(serverCup.id);
                const removeQueuedOp = ownerId
                  ? enqueueOutboxOperation(ownerId, {
                      kind: 'remove_coffee',
                      payload: {
                        id: serverCup.id,
                        date: today,
                        tagId: tagId || undefined,
                        createdAt: created.createdAt,
                      },
                    })
                  : null;
                convexMutations
                  .removeCup({
                    id: serverCup.id,
                    date: today,
                    tagId: tagId || undefined,
                  })
                  .then(() => {
                    if (removeQueuedOp) removeOutboxOperation(removeQueuedOp.id);
                  })
                  .finally(() => {
                    pendingDeletesRef.current.delete(serverCup.id);
                    removePendingDeletedCreatedAt(created.createdAt);
                  })
                  .catch((err) => {
                    console.warn('Convex removeCup error:', err);
                  });
              } else {
                removePendingDeletedCreatedAt(created.createdAt);
              }
              return;
            }
            if (serverCup && serverCup.id) {
              setCoffeeCups((prev) => {
                if (
                  created.id !== serverCup.id &&
                  prev.some((c) => c.id === serverCup.id)
                ) {
                  return prev.filter((c) => c.id !== created.id);
                }
                return prev.map((c) =>
                  c.id === created.id ? { ...c, id: serverCup.id } : c
                );
              });
              void coffeeRepository.replaceId(created.id, serverCup.id);
              void telemetryTracker.reconcileCoffeeCupId(created.id, serverCup.id);
            }
          })
          .catch((err) => {
            // Keep queuedOp in persistent outbox for reconnect replay unless cancelled by delete
            pendingAddsRef.current.delete(created.id);
            if (pendingDeletesRef.current.delete(created.id)) {
              removePendingDeletedCreatedAt(created.createdAt);
            }
            console.warn('Convex addCup error:', err);
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
      removePendingDeletedCreatedAt,
    ]
  );

  const removeCoffeeCup = useCallback(
    async (dateStr?: string, tagId?: string | null, cupId?: string): Promise<boolean> => {
      const today = dateStr || toDateKey(new Date());
      const removedCup = await coffeeRepository.removeCup(today, tagId, cupId);
      if (removedCup) {
        if (!isEffectiveAuthenticated) {
          markGuestDataModified();
        }
        const shouldSyncToCloud = isConvexConfigured && isEffectiveAuthenticated;
        const isPendingAdd = shouldSyncToCloud && pendingAddsRef.current.has(removedCup.id);
        const ownerId = shouldSyncToCloud ? getActiveOwnerUserId() : null;

        // Enqueue remove_coffee in persistent outbox (automatically cancels an un-synced offline add_coffee)
        const queuedOp =
          shouldSyncToCloud && ownerId && !isPendingAdd
            ? enqueueOutboxOperation(ownerId, {
                kind: 'remove_coffee',
                payload: {
                  id: removedCup.id,
                  date: removedCup.date,
                  tagId: removedCup.tagId ?? undefined,
                  createdAt: removedCup.createdAt,
                },
              })
            : null;

        if (shouldSyncToCloud && isPendingAdd) {
          pendingDeletesRef.current.add(removedCup.id);
          addPendingDeletedCreatedAt(removedCup.createdAt);
        }

        const updated = await coffeeRepository.getAll();
        const sortedUpdated = [...updated].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        coffeeCupsRef.current = sortedUpdated;
        setCoffeeCups(sortedUpdated);
        broadcastCoffeeCups(sortedUpdated);

        void telemetryTracker.onCoffeeRemoved(removedCup);

        // If queuedOp === null when ownerId was present, the remove cancelled an un-synced offline add_coffee
        const shouldSendRemoveMutation =
          shouldSyncToCloud &&
          !isPendingAdd &&
          isConvexAuthReady &&
          isConvexConnectedRef.current &&
          (!ownerId || queuedOp !== null);

        if (shouldSendRemoveMutation) {
          pendingDeletesRef.current.add(removedCup.id);
          addPendingDeletedCreatedAt(removedCup.createdAt);
          convexMutations
            .removeCup({
              id: removedCup.id,
              date: removedCup.date,
              tagId: removedCup.tagId ?? undefined,
            })
            .then(() => {
              if (queuedOp) {
                removeOutboxOperation(queuedOp.id);
              }
            })
            .finally(() => {
              pendingDeletesRef.current.delete(removedCup.id);
              removePendingDeletedCreatedAt(removedCup.createdAt);
            })
            .catch((err) => {
              // Keep queuedOp in persistent outbox for reconnect replay
              console.warn('Convex removeCup error:', err);
            });
        }
        return true;
      }
      return false;
    },
    [
      isConvexConfigured,
      isEffectiveAuthenticated,
      isConvexAuthReady,
      convexMutations,
      getActiveOwnerUserId,
      addPendingDeletedCreatedAt,
      removePendingDeletedCreatedAt,
    ]
  );

  return {
    coffeeCups,
    setCoffeeCups,
    addCoffeeCup,
    removeCoffeeCup,
  };
}

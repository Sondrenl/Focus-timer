import { useState, useEffect, useCallback, useRef } from 'react';
import { CoffeeCup } from '../../types/coffee';
import {
  broadcastCoffeeCups,
  subscribeCoffeeCups,
  subscribeReset,
} from '../../services/timer/TimerBroadcast';
import { toDateKey } from '../../utils/dates';
import { coffeeRepository, telemetryTracker } from '../../context/services';
import { useAuthProfile } from '../../context/AuthProfileContext';
import { TIMER_STORAGE_KEY } from '../../context/timer/timerPersistence';
import { SessionType, TimerStatus } from '../../types/timer';

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
  convexSync: ReturnType<typeof useAuthProfile>['convexSync'];
}

export function useCoffeeData({
  isEffectiveAuthenticated,
  convexSync,
}: UseCoffeeDataParams) {
  const { isConvexConfigured, convexCoffee, mutations: convexMutations } = convexSync;

  const [coffeeCups, setCoffeeCups] = useState<CoffeeCup[]>([]);

  const pendingAddsRef = useRef<Map<string, CoffeeCup>>(new Map());
  const pendingDeletesRef = useRef<Set<string>>(new Set());

  // Initial load of coffee cups from local storage
  useEffect(() => {
    async function initCoffee() {
      const loadedCoffee = await coffeeRepository.getAll();
      setCoffeeCups(loadedCoffee);
    }

    initCoffee();
  }, []);

  // Reactive adoption of Convex coffee cups
  useEffect(() => {
    if (!isEffectiveAuthenticated || !Array.isArray(convexCoffee)) return;

    const serverCups = convexCoffee as CoffeeCup[];
    const pendingDeletes = pendingDeletesRef.current;
    const pendingAdds = Array.from(pendingAddsRef.current.values());

    const remainingServer = serverCups.filter((c) => !pendingDeletes.has(c.id));
    const serverIds = new Set(remainingServer.map((c) => c.id));
    const serverCreatedTimes = new Set(remainingServer.map((c) => c.createdAt));

    const unconfirmedAdds = pendingAdds.filter(
      (a) =>
        !pendingDeletes.has(a.id) &&
        !serverIds.has(a.id) &&
        !serverCreatedTimes.has(a.createdAt)
    );

    const merged = [...remainingServer, ...unconfirmedAdds].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    setCoffeeCups((prev) => {
      if (
        prev.length === merged.length &&
        prev.every(
          (c, i) =>
            c.id === merged[i].id &&
            c.date === merged[i].date &&
            c.tagId === merged[i].tagId &&
            c.createdAt === merged[i].createdAt
        )
      ) {
        return prev;
      }
      coffeeRepository.saveAll(merged);
      return merged;
    });
  }, [convexCoffee, isEffectiveAuthenticated]);

  // Multi-tab BroadcastChannel synchronization for coffee cups
  useEffect(() => {
    const unsubCoffee = subscribeCoffeeCups((cups) => {
      coffeeRepository.saveAll(cups);
      setCoffeeCups(cups);
    });

    const unsubReset = subscribeReset(() => {
      pendingAddsRef.current.clear();
      pendingDeletesRef.current.clear();
      setCoffeeCups([]);
    });

    return () => {
      unsubCoffee();
      unsubReset();
    };
  }, []);

  const addCoffeeCup = useCallback(
    async (tagId: string | null, dateStr?: string): Promise<CoffeeCup> => {
      const today = dateStr || toDateKey(new Date());
      const created = await coffeeRepository.addCup(today, tagId);

      pendingAddsRef.current.set(created.id, created);

      const updated = await coffeeRepository.getAll();
      const sortedUpdated = [...updated].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      setCoffeeCups(sortedUpdated);
      broadcastCoffeeCups(sortedUpdated);

      const activeTimer = readActiveTimerContext();
      void telemetryTracker.onCoffeeLogged({
        cup: created,
        allCupsAfterAdd: sortedUpdated,
        timerStatus: activeTimer.status,
        activeSessionType: activeTimer.sessionType,
      });

      if (isConvexConfigured && isEffectiveAuthenticated) {
        convexMutations
          .addCup({
            date: today,
            tagId: tagId || undefined,
            createdAt: created.createdAt,
          })
          .then((serverCup) => {
            pendingAddsRef.current.delete(created.id);
            if (pendingDeletesRef.current.has(created.id)) {
              pendingDeletesRef.current.delete(created.id);
              if (serverCup && serverCup.id) {
                pendingDeletesRef.current.add(serverCup.id);
                convexMutations
                  .removeCup({
                    id: serverCup.id,
                    date: today,
                    tagId: tagId || undefined,
                  })
                  .finally(() => {
                    pendingDeletesRef.current.delete(serverCup.id);
                  })
                  .catch((err) => {
                    console.warn('Convex removeCup error:', err);
                  });
              }
              return;
            }
            if (serverCup && serverCup.id) {
              setCoffeeCups((prev) =>
                prev.map((c) => (c.id === created.id ? { ...c, id: serverCup.id } : c))
              );
              coffeeRepository.getAll().then((all) => {
                const withServerId = all.map((c) =>
                  c.id === created.id ? { ...c, id: serverCup.id } : c
                );
                coffeeRepository.saveAll(withServerId);
              });
              void telemetryTracker.reconcileCoffeeCupId(created.id, serverCup.id);
            }
          })
          .catch((err) => {
            pendingAddsRef.current.delete(created.id);
            pendingDeletesRef.current.delete(created.id);
            console.warn('Convex addCup error:', err);
          });
      }
      return created;
    },
    [isConvexConfigured, isEffectiveAuthenticated, convexMutations]
  );

  const removeCoffeeCup = useCallback(
    async (dateStr?: string, tagId?: string | null, cupId?: string): Promise<boolean> => {
      const today = dateStr || toDateKey(new Date());
      const removedCup = await coffeeRepository.removeCup(today, tagId, cupId);
      if (removedCup) {
        const isPendingAdd = pendingAddsRef.current.has(removedCup.id);
        pendingDeletesRef.current.add(removedCup.id);

        const updated = await coffeeRepository.getAll();
        const sortedUpdated = [...updated].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        setCoffeeCups(sortedUpdated);
        broadcastCoffeeCups(sortedUpdated);

        void telemetryTracker.onCoffeeRemoved(removedCup);

        if (isConvexConfigured && isEffectiveAuthenticated && !isPendingAdd) {
          convexMutations
            .removeCup({
              id: removedCup.id,
              date: today,
              tagId: tagId || undefined,
            })
            .finally(() => {
              pendingDeletesRef.current.delete(removedCup.id);
            })
            .catch((err) => {
              console.warn('Convex removeCup error:', err);
            });
        }
        return true;
      }
      return false;
    },
    [isConvexConfigured, isEffectiveAuthenticated, convexMutations]
  );

  return {
    coffeeCups,
    setCoffeeCups,
    addCoffeeCup,
    removeCoffeeCup,
  };
}

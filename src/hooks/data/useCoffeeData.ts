import { useState, useEffect, useCallback, useRef } from 'react';
import { CoffeeCup } from '../../types/coffee';
import {
  broadcastCoffeeCups,
  subscribeCoffeeCups,
  subscribeReset,
} from '../../services/timer/TimerBroadcast';
import { toDateKey } from '../../utils/dates';
import { coffeeRepository } from '../../context/services';
import { useAuthProfile } from '../../context/AuthProfileContext';

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
  const coffeeCupsRef = useRef<CoffeeCup[]>(coffeeCups);
  coffeeCupsRef.current = coffeeCups;

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
      (a) => !serverIds.has(a.id) && !serverCreatedTimes.has(a.createdAt)
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

      if (isConvexConfigured && isEffectiveAuthenticated) {
        convexMutations
          .addCup({
            date: today,
            tagId: tagId || undefined,
            createdAt: created.createdAt,
          })
          .then((serverCup) => {
            pendingAddsRef.current.delete(created.id);
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
            }
          })
          .catch((err) => {
            pendingAddsRef.current.delete(created.id);
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
        pendingDeletesRef.current.add(removedCup.id);

        const updated = await coffeeRepository.getAll();
        const sortedUpdated = [...updated].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        setCoffeeCups(sortedUpdated);
        broadcastCoffeeCups(sortedUpdated);

        if (isConvexConfigured && isEffectiveAuthenticated) {
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
    coffeeCupsRef,
    addCoffeeCup,
    removeCoffeeCup,
  };
}

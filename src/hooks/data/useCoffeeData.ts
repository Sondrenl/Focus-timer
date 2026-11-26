import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { CoffeeCup } from '../../types/coffee';
import { toDateKey } from '../../utils/dates';
import { coffeeRepository } from '../../context/services';
import { useAuthProfile } from '../../context/AuthProfileContext';
import { markGuestDataModified } from '../../services/sync/offlineOutbox';

interface UseCoffeeDataParams {
  isAuthenticated: boolean;
  isAdoptionPaused?: boolean;
  convexSync: ReturnType<typeof useAuthProfile>['convexSync'];
}

export function useCoffeeData({
  isAuthenticated,
  convexSync,
}: UseCoffeeDataParams) {
  const { isConvexConfigured, convexCoffee, mutations: convexMutations } = convexSync;
  const isCloudMode = isConvexConfigured && isAuthenticated;

  const [guestCoffeeCups, setGuestCoffeeCups] = useState<CoffeeCup[]>([]);
  const wasAuthenticatedRef = useRef<boolean>(isAuthenticated);

  // Initial load of guest coffee cups from localStorage
  useEffect(() => {
    coffeeRepository.getAll().then(setGuestCoffeeCups);
  }, []);

  // Clear in-memory guest coffee cups on sign-out so pre-sign-in data never reappears
  useEffect(() => {
    const wasAuth = wasAuthenticatedRef.current;
    wasAuthenticatedRef.current = isAuthenticated;
    if (wasAuth && !isAuthenticated) {
      setGuestCoffeeCups([]);
    }
  }, [isAuthenticated]);

  const coffeeCups = useMemo<CoffeeCup[]>(() => {
    if (isCloudMode) {
      return Array.isArray(convexCoffee) ? (convexCoffee as CoffeeCup[]) : [];
    }
    return guestCoffeeCups;
  }, [isCloudMode, convexCoffee, guestCoffeeCups]);

  const addCoffeeCup = useCallback(
    async (tagId: string | null, dateStr?: string): Promise<CoffeeCup> => {
      const today = dateStr || toDateKey(new Date());
      const nowIso = new Date().toISOString();

      if (isCloudMode) {
        const serverCup = await convexMutations.addCup({
          date: today,
          tagId: tagId || undefined,
          createdAt: nowIso,
        });
        return {
          id: serverCup?.id ?? `cup-${Date.now()}`,
          date: serverCup?.date ?? today,
          tagId: serverCup?.tagId ?? tagId ?? null,
          createdAt: serverCup?.createdAt ?? nowIso,
        };
      }

      const created = await coffeeRepository.addCup(today, tagId);
      markGuestDataModified();
      const updated = await coffeeRepository.getAll();
      const sorted = [...updated].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      setGuestCoffeeCups(sorted);
      return created;
    },
    [isCloudMode, convexMutations]
  );

  const removeCoffeeCup = useCallback(
    async (dateStr?: string, tagId?: string | null, cupId?: string): Promise<boolean> => {
      const today = dateStr || toDateKey(new Date());

      if (isCloudMode) {
        const res = await convexMutations.removeCup({
          ...(cupId ? { id: cupId } : {}),
          date: today,
          ...(tagId !== undefined ? { tagId } : {}),
        });
        return Boolean(res);
      }

      const removedCup = await coffeeRepository.removeCup(today, tagId, cupId);
      if (!removedCup) return false;
      markGuestDataModified();
      const updated = await coffeeRepository.getAll();
      const sorted = [...updated].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      setGuestCoffeeCups(sorted);
      return true;
    },
    [isCloudMode, convexMutations]
  );

  return {
    coffeeCups,
    setCoffeeCups: setGuestCoffeeCups,
    addCoffeeCup,
    removeCoffeeCup,
  };
}

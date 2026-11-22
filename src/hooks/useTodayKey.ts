import { useEffect, useState } from 'react';
import { toDateKey } from '../utils/dates';

/**
 * Returns the current local calendar date key ('YYYY-MM-DD') and updates automatically
 * when local midnight passes or when the tab wakes from sleep / regains visibility.
 */
export function useTodayKey(): string {
  const [todayKey, setTodayKey] = useState<string>(() => toDateKey(new Date()));

  useEffect(() => {
    let midnightTimeout: ReturnType<typeof setTimeout> | null = null;

    const refresh = () => {
      const next = toDateKey(new Date());
      setTodayKey((prev) => (prev === next ? prev : next));
    };

    const scheduleNextMidnight = () => {
      if (midnightTimeout !== null) {
        clearTimeout(midnightTimeout);
        midnightTimeout = null;
      }
      const now = new Date();
      const nextMidnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        0,
        0,
        0,
        50
      );
      const delayMs = Math.max(1000, nextMidnight.getTime() - now.getTime());
      midnightTimeout = setTimeout(() => {
        refresh();
        scheduleNextMidnight();
      }, delayMs);
    };

    const handleWake = () => {
      refresh();
      scheduleNextMidnight();
    };

    refresh();
    scheduleNextMidnight();

    const fallbackInterval = setInterval(refresh, 60_000);

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleWake);
      window.addEventListener('focus', handleWake);
      window.addEventListener('pageshow', handleWake);
    }

    return () => {
      if (midnightTimeout !== null) {
        clearTimeout(midnightTimeout);
      }
      clearInterval(fallbackInterval);
      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleWake);
        window.removeEventListener('focus', handleWake);
        window.removeEventListener('pageshow', handleWake);
      }
    };
  }, []);

  return todayKey;
}

import { IStorageService, StorageSetOptions } from './IStorageService';

/**
 * Robust LocalStorage implementation of IStorageService with in-memory fallback
 * in case localStorage is unavailable (e.g. strict private browsing or disabled cookies).
 */
export class LocalStorageService implements IStorageService {
  private prefix: string;
  private memoryCache: Map<string, string> = new Map();
  private isLocalStorageAvailable: boolean = true;
  private hasWarnedQuota: boolean = false;

  constructor(prefix: string = 'pomodor:') {
    this.prefix = prefix;
    this.checkAvailability();
  }

  private checkAvailability(): void {
    try {
      const testKey = `${this.prefix}__test__`;
      window.localStorage.setItem(testKey, 'test');
      window.localStorage.removeItem(testKey);
      this.isLocalStorageAvailable = true;
    } catch {
      this.isLocalStorageAvailable = false;
      console.warn('LocalStorage unavailable. Falling back to in-memory storage.');
    }
  }

  private isQuotaExceededError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const e = err as { name?: string; code?: number };
    return (
      e.name === 'QuotaExceededError' ||
      e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      e.code === 22 ||
      e.code === 1014
    );
  }

  getItem<T>(key: string, defaultValue: T): T {
    const fullKey = `${this.prefix}${key}`;
    try {
      let raw: string | null = null;
      if (this.isLocalStorageAvailable) {
        raw = this.memoryCache.get(fullKey) ?? window.localStorage.getItem(fullKey);
      } else {
        raw = this.memoryCache.get(fullKey) ?? null;
      }

      if (raw === null) {
        return defaultValue;
      }
      return JSON.parse(raw) as T;
    } catch (err) {
      console.error(`Error reading key "${key}" from storage:`, err);
      return defaultValue;
    }
  }

  setItem<T>(key: string, value: T, options?: StorageSetOptions): void {
    const fullKey = `${this.prefix}${key}`;
    let serialized: string;
    try {
      serialized = JSON.stringify(value);
    } catch (err) {
      console.error(`Error serializing key "${key}" for storage:`, err);
      return;
    }

    if (this.isLocalStorageAvailable) {
      try {
        window.localStorage.setItem(fullKey, serialized);
        this.memoryCache.delete(fullKey);
        this.hasWarnedQuota = false;
      } catch (err) {
        this.memoryCache.set(fullKey, serialized);
        if (this.isQuotaExceededError(err)) {
          if (!this.hasWarnedQuota) {
            this.hasWarnedQuota = true;
            console.warn(
              `LocalStorage quota exceeded while writing key "${key}". Keeping value in memory fallback.`,
              err
            );
          }
          if (options?.throwOnQuotaError === true) {
            throw err;
          }
        } else {
          console.error(`Error writing key "${key}" to storage:`, err);
        }
      }
    } else {
      this.memoryCache.set(fullKey, serialized);
    }
  }

  removeItem(key: string): void {
    const fullKey = `${this.prefix}${key}`;
    try {
      this.memoryCache.delete(fullKey);
      if (this.isLocalStorageAvailable) {
        window.localStorage.removeItem(fullKey);
      }
    } catch (err) {
      console.error(`Error removing key "${key}" from storage:`, err);
    }
  }

  clear(): void {
    try {
      this.memoryCache.clear();
      if (this.isLocalStorageAvailable) {
        const keysToRemove: string[] = [];
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (k && k.startsWith(this.prefix)) {
            keysToRemove.push(k);
          }
        }
        keysToRemove.forEach((k) => window.localStorage.removeItem(k));
      }
    } catch (err) {
      console.error('Error clearing app storage:', err);
    }
  }
}

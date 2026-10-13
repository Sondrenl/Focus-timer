import { IStorageService } from './IStorageService';

/**
 * Robust LocalStorage implementation of IStorageService with in-memory fallback
 * in case localStorage is unavailable (e.g. strict private browsing or disabled cookies).
 */
export class LocalStorageService implements IStorageService {
  private prefix: string;
  private memoryCache: Map<string, string> = new Map();
  private isLocalStorageAvailable: boolean = true;

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

  getItem<T>(key: string, defaultValue: T): T {
    const fullKey = `${this.prefix}${key}`;
    try {
      let raw: string | null = null;
      if (this.isLocalStorageAvailable) {
        raw = window.localStorage.getItem(fullKey);
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

  setItem<T>(key: string, value: T): void {
    const fullKey = `${this.prefix}${key}`;
    try {
      const serialized = JSON.stringify(value);
      if (this.isLocalStorageAvailable) {
        window.localStorage.setItem(fullKey, serialized);
      } else {
        this.memoryCache.set(fullKey, serialized);
      }
    } catch (err) {
      console.error(`Error writing key "${key}" to storage:`, err);
    }
  }

  removeItem(key: string): void {
    const fullKey = `${this.prefix}${key}`;
    try {
      if (this.isLocalStorageAvailable) {
        window.localStorage.removeItem(fullKey);
      } else {
        this.memoryCache.delete(fullKey);
      }
    } catch (err) {
      console.error(`Error removing key "${key}" from storage:`, err);
    }
  }

  clear(): void {
    try {
      if (this.isLocalStorageAvailable) {
        const keysToRemove: string[] = [];
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (k && k.startsWith(this.prefix)) {
            keysToRemove.push(k);
          }
        }
        keysToRemove.forEach((k) => window.localStorage.removeItem(k));
      } else {
        this.memoryCache.clear();
      }
    } catch (err) {
      console.error('Error clearing app storage:', err);
    }
  }
}

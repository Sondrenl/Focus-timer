export interface StorageSetOptions {
  /**
   * When true, rethrows QuotaExceededError after updating the in-memory fallback cache.
   * Defaults to false so callers that do not implement quota eviction do not crash.
   */
  throwOnQuotaError?: boolean;
}

/**
 * Generic Storage Service abstraction interface.
 * Decouples domain logic from browser localStorage, facilitating future
 * migration to IndexedDB, REST API, or GraphQL backends.
 */
export interface IStorageService {
  /**
   * Retrieves and deserializes a value from storage
   * @param key Storage lookup key
   * @param defaultValue Fallback value if key is not found
   */
  getItem<T>(key: string, defaultValue: T): T;

  /**
   * Serializes and writes a value into storage
   * @param key Storage destination key
   * @param value Value to persist
   * @param options Optional write behavior flags
   */
  setItem<T>(key: string, value: T, options?: StorageSetOptions): void;

  /**
   * Removes an entry from storage
   * @param key Storage key to evict
   */
  removeItem(key: string): void;

  /**
   * Clears all storage entries matching app prefix
   */
  clear(): void;
}

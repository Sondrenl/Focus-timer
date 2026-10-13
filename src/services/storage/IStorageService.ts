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
   */
  setItem<T>(key: string, value: T): void;

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

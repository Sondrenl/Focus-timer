import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isChunkLoadError,
  handleChunkLoadFailure,
  initChunkResilience,
  CHUNK_RELOAD_STORAGE_KEY,
  CHUNK_RELOAD_COOLDOWN_MS,
} from '../src/utils/chunkResilience';

describe('Chunk Loading & Dynamic Import Resilience', () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};

    const listeners: Record<string, EventListener[]> = {};

    const mockWindow = {
      sessionStorage: {
        getItem: (key: string) => mockStorage[key] || null,
        setItem: (key: string, val: string) => {
          mockStorage[key] = val;
        },
        removeItem: (key: string) => {
          delete mockStorage[key];
        },
        clear: () => {
          mockStorage = {};
        },
      },
      location: {
        reload: vi.fn(),
      },
      addEventListener: (type: string, listener: EventListener) => {
        listeners[type] = listeners[type] || [];
        listeners[type].push(listener);
      },
      removeEventListener: (type: string, listener: EventListener) => {
        if (!listeners[type]) return;
        listeners[type] = listeners[type].filter((l) => l !== listener);
      },
      dispatchEvent: (event: Event) => {
        const list = listeners[event.type] || [];
        for (const listener of list) {
          listener(event);
        }
        return !event.defaultPrevented;
      },
    };

    vi.stubGlobal('window', mockWindow);
    vi.stubGlobal('sessionStorage', mockWindow.sessionStorage);
    vi.stubGlobal('location', mockWindow.location);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('isChunkLoadError', () => {
    it('detects standard Chrome dynamic import failure', () => {
      const error = new Error('TypeError: Failed to fetch dynamically imported module: https://pomodor.app/assets/stats-abc.js');
      expect(isChunkLoadError(error)).toBe(true);
    });

    it('detects Firefox dynamic import failure', () => {
      const error = new Error('error loading dynamically imported module: https://pomodor.app/assets/stats-abc.js');
      expect(isChunkLoadError(error)).toBe(true);
    });

    it('detects Safari module script failure', () => {
      const error = new Error('Importing a module script failed.');
      expect(isChunkLoadError(error)).toBe(true);
    });

    it('detects Vite CSS preload failure', () => {
      const error = new Error('Unable to preload CSS for /assets/index-xyz.css');
      expect(isChunkLoadError(error)).toBe(true);
    });

    it('detects webpack-style chunk load failure', () => {
      const error = new Error('Loading chunk 4 failed.');
      expect(isChunkLoadError(error)).toBe(true);
    });

    it('handles raw string errors', () => {
      expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(true);
    });

    it('returns false for unrelated errors', () => {
      expect(isChunkLoadError(new Error('Network request failed for /api/session'))).toBe(false);
      expect(isChunkLoadError(new Error('Uncaught ReferenceError: foo is not defined'))).toBe(false);
      expect(isChunkLoadError(null)).toBe(false);
      expect(isChunkLoadError(undefined)).toBe(false);
    });
  });

  describe('handleChunkLoadFailure (Infinite Reload Guard)', () => {
    it('reloads the page on first dynamic import failure and sets cooldown', () => {
      const reloadMock = vi.fn();
      const result = handleChunkLoadFailure(new Error('Failed to fetch dynamically imported module'), reloadMock);

      expect(result).toBe(true);
      expect(reloadMock).toHaveBeenCalledTimes(1);
      expect(mockStorage[CHUNK_RELOAD_STORAGE_KEY]).toBeDefined();
    });

    it('suppresses reload if called again within cooldown period to prevent infinite reload loop', () => {
      const reloadMock = vi.fn();
      const now = Date.now();
      mockStorage[CHUNK_RELOAD_STORAGE_KEY] = String(now - 5000); // 5s ago, cooldown is 20s

      const result = handleChunkLoadFailure(new Error('Failed to fetch dynamically imported module'), reloadMock);

      expect(result).toBe(false);
      expect(reloadMock).not.toHaveBeenCalled();
    });

    it('allows reload if previous reload was outside the cooldown window', () => {
      const reloadMock = vi.fn();
      const oldTime = Date.now() - (CHUNK_RELOAD_COOLDOWN_MS + 5000); // 25s ago
      mockStorage[CHUNK_RELOAD_STORAGE_KEY] = String(oldTime);

      const result = handleChunkLoadFailure(new Error('Failed to fetch dynamically imported module'), reloadMock);

      expect(result).toBe(true);
      expect(reloadMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('initChunkResilience (Event Binding)', () => {
    it('catches vite:preloadError and triggers reload guard with preventDefault', () => {
      const reloadMock = vi.fn();
      window.location.reload = reloadMock;

      const cleanup = initChunkResilience();

      const preloadEvent = new Event('vite:preloadError', { cancelable: true }) as Event & { payload: Error };
      preloadEvent.payload = new Error('Failed to fetch dynamically imported module');

      window.dispatchEvent(preloadEvent);

      expect(preloadEvent.defaultPrevented).toBe(true);
      expect(reloadMock).toHaveBeenCalledTimes(1);

      cleanup();
    });

    it('catches unhandledrejection for chunk errors with preventDefault', () => {
      const reloadMock = vi.fn();
      window.location.reload = reloadMock;

      const cleanup = initChunkResilience();

      const rejectionEvent = new Event('unhandledrejection', { cancelable: true }) as Event & {
        reason: Error;
        promise: Promise<void>;
      };
      rejectionEvent.reason = new Error('Failed to fetch dynamically imported module');
      rejectionEvent.promise = Promise.reject(rejectionEvent.reason).catch(() => {});

      window.dispatchEvent(rejectionEvent);

      expect(rejectionEvent.defaultPrevented).toBe(true);
      expect(reloadMock).toHaveBeenCalledTimes(1);

      cleanup();
    });

    it('ignores unhandledrejection for non-chunk errors without preventDefault', () => {
      const reloadMock = vi.fn();
      window.location.reload = reloadMock;

      const cleanup = initChunkResilience();

      const rejectionEvent = new Event('unhandledrejection', { cancelable: true }) as Event & {
        reason: Error;
        promise: Promise<void>;
      };
      rejectionEvent.reason = new Error('Database query failed');
      rejectionEvent.promise = Promise.reject(rejectionEvent.reason).catch(() => {});

      window.dispatchEvent(rejectionEvent);

      expect(rejectionEvent.defaultPrevented).toBe(false);
      expect(reloadMock).not.toHaveBeenCalled();

      cleanup();
    });
  });
});

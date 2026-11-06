/**
 * Chunk Loading & Dynamic Import Resilience
 *
 * Protects against runtime crashes when a new deployment invalidates
 * older hashed JavaScript/CSS chunks while a client tab remains open.
 */

export const CHUNK_RELOAD_STORAGE_KEY = 'pomodoro_last_chunk_reload';
export const CHUNK_RELOAD_COOLDOWN_MS = 20_000;

export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;

  let message = '';
  if (typeof error === 'string') {
    message = error;
  } else if (typeof error === 'object' && error !== null) {
    if ('message' in error && typeof (error as { message: unknown }).message === 'string') {
      message = (error as { message: string }).message;
    } else {
      message = String(error);
    }
  }

  return (
    /failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /importing a module script failed/i.test(message) ||
    /unable to preload css/i.test(message) ||
    /loading chunk .* failed/i.test(message)
  );
}

export function handleChunkLoadFailure(
  error: unknown,
  reloadFn: () => void = () => {
    if (typeof window !== 'undefined' && window.location) {
      window.location.reload();
    }
  }
): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const lastReloadStr = window.sessionStorage?.getItem(CHUNK_RELOAD_STORAGE_KEY);
    const now = Date.now();

    if (lastReloadStr) {
      const lastReloadTime = parseInt(lastReloadStr, 10);
      if (!isNaN(lastReloadTime) && now - lastReloadTime < CHUNK_RELOAD_COOLDOWN_MS) {
        console.warn(
          '[ChunkResilience] Repeated chunk load failure detected within cooldown period. Skipping auto-reload to prevent infinite loop.',
          error
        );
        return false;
      }
    }

    try {
      window.sessionStorage?.setItem(CHUNK_RELOAD_STORAGE_KEY, String(now));
    } catch {
      // Ignore sessionStorage write errors (e.g. storage quota, private browsing)
    }

    console.warn(
      '[ChunkResilience] Dynamic import chunk load failure detected. Reloading page to fetch latest deployment assets...',
      error
    );
    reloadFn();
    return true;
  } catch (err) {
    console.error('[ChunkResilience] Error while handling chunk load failure:', err);
    return false;
  }
}

/**
 * Initializes listeners for Vite dynamic import preload errors and unhandled module fetch rejections.
 * Returns an unbind cleanup function.
 */
export function initChunkResilience(): () => void {
  if (typeof window === 'undefined') return () => {};

  // Clean up any expired reload marker from previous visits
  try {
    const lastReloadStr = window.sessionStorage?.getItem(CHUNK_RELOAD_STORAGE_KEY);
    if (lastReloadStr) {
      const lastReloadTime = parseInt(lastReloadStr, 10);
      if (!isNaN(lastReloadTime) && Date.now() - lastReloadTime > CHUNK_RELOAD_COOLDOWN_MS) {
        window.sessionStorage?.removeItem(CHUNK_RELOAD_STORAGE_KEY);
      }
    }
  } catch {
    // Ignore storage errors
  }

  const onPreloadError = (event: Event) => {
    // Prevent default Vite behavior (which re-throws the error)
    if (typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    const payload = (event as Event & { payload?: Error }).payload || new Error('Vite dynamic preload failed');
    handleChunkLoadFailure(payload);
  };

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    if (isChunkLoadError(reason)) {
      if (typeof event.preventDefault === 'function') {
        event.preventDefault();
      }
      handleChunkLoadFailure(reason);
    }
  };

  window.addEventListener('vite:preloadError', onPreloadError as EventListener);
  window.addEventListener('unhandledrejection', onUnhandledRejection);

  return () => {
    window.removeEventListener('vite:preloadError', onPreloadError as EventListener);
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
  };
}

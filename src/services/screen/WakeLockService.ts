/**
 * Screen Wake Lock Service to prevent mobile and desktop displays from sleeping
 */
export class WakeLockService {
  private static instance: WakeLockService;
  private sentinel: WakeLockSentinel | null = null;
  private isRequested: boolean = false;
  private pendingAcquire: Promise<boolean> | null = null;

  private constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (this.isRequested && document.visibilityState === 'visible') {
          void this.acquire();
        }
      });
    }
  }

  public static getInstance(): WakeLockService {
    if (!WakeLockService.instance) {
      WakeLockService.instance = new WakeLockService();
    }
    return WakeLockService.instance;
  }

  public isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  }

  public async acquire(): Promise<boolean> {
    this.isRequested = true;
    if (!this.isSupported()) return false;

    if (this.sentinel && !this.sentinel.released) {
      return true;
    }

    if (this.pendingAcquire) {
      return this.pendingAcquire;
    }

    let requestPromise: Promise<boolean> | null = null;
    requestPromise = (async () => {
      try {
        const acquired = await navigator.wakeLock.request('screen');

        // If release() was called while wakeLock.request() was still resolving, immediately release it
        if (!this.isRequested) {
          try {
            await acquired.release();
          } catch {
            // Ignored
          }
          return false;
        }

        // Release any stale sentinel if somehow replaced
        if (this.sentinel && this.sentinel !== acquired && !this.sentinel.released) {
          try {
            await this.sentinel.release();
          } catch {
            // Ignored
          }
        }

        this.sentinel = acquired;
        acquired.addEventListener('release', () => {
          if (this.sentinel === acquired) {
            this.sentinel = null;
          }
        });
        return true;
      } catch (err) {
        console.warn('WakeLock acquire failed or rejected:', err);
        return false;
      } finally {
        if (this.pendingAcquire === requestPromise) {
          this.pendingAcquire = null;
        }
      }
    })();

    this.pendingAcquire = requestPromise;
    return requestPromise;
  }

  public async release(): Promise<void> {
    this.isRequested = false;
    const active = this.sentinel;
    this.sentinel = null;
    if (active && !active.released) {
      try {
        await active.release();
      } catch {
        // Ignored
      }
    }
  }
}

export const wakeLockService = WakeLockService.getInstance();

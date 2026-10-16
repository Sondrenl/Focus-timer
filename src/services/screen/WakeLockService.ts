/**
 * Screen Wake Lock Service to prevent mobile and desktop displays from sleeping
 */
export class WakeLockService {
  private static instance: WakeLockService;
  private sentinel: WakeLockSentinel | null = null;
  private isRequested: boolean = false;

  private constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (this.isRequested && document.visibilityState === 'visible') {
          this.acquire();
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

    try {
      if (!this.sentinel || this.sentinel.released) {
        this.sentinel = await navigator.wakeLock.request('screen');
        this.sentinel.addEventListener('release', () => {
          this.sentinel = null;
        });
      }
      return true;
    } catch (err) {
      console.warn('WakeLock acquire failed or rejected:', err);
      return false;
    }
  }

  public async release(): Promise<void> {
    this.isRequested = false;
    if (this.sentinel) {
      try {
        await this.sentinel.release();
      } catch {
        // Ignored
      }
      this.sentinel = null;
    }
  }
}

export const wakeLockService = WakeLockService.getInstance();

import { SessionType } from '../../types/timer';

export type NotificationPermissionStatus = NotificationPermission | 'unsupported';

/**
 * Service to handle browser & mobile Home Screen / lock-screen notifications via Service Worker
 * with per-session tag deduplication and live permission status inspection.
 */
export class NotificationService {
  private swRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;
  private cachedRegistration: ServiceWorkerRegistration | null = null;
  private lastNotifiedTag: string | null = null;

  constructor() {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      this.swRegistrationPromise = navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          this.cachedRegistration = reg;
          reg.update().catch(() => {});
          return reg;
        })
        .catch((err) => {
          console.warn('Service worker registration failed:', err);
          return null;
        });

      navigator.serviceWorker.ready
        .then((reg) => {
          this.cachedRegistration = reg;
        })
        .catch(() => {});
    }
  }

  isSupported(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window;
  }

  getPermissionState(): NotificationPermissionStatus {
    if (!this.isSupported()) return 'unsupported';
    return Notification.permission;
  }

  async requestPermission(): Promise<boolean> {
    if (!this.isSupported()) return false;
    try {
      if (Notification.permission === 'granted') {
        return true;
      }
      const permission = await new Promise<NotificationPermission>((resolve) => {
        try {
          const maybePromise = Notification.requestPermission((res) => resolve(res));
          if (maybePromise && typeof maybePromise.then === 'function') {
            maybePromise.then(resolve).catch(() => resolve(Notification.permission));
          }
        } catch {
          resolve(Notification.permission);
        }
      });
      return permission === 'granted';
    } catch {
      return false;
    }
  }

  hasPermission(): boolean {
    if (!this.isSupported()) return false;
    return Notification.permission === 'granted';
  }

  private async getActiveRegistration(): Promise<ServiceWorkerRegistration | null> {
    if (this.cachedRegistration?.active) {
      return this.cachedRegistration;
    }
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return null;
    }
    try {
      const existing = await navigator.serviceWorker.getRegistration();
      if (existing?.active) {
        this.cachedRegistration = existing;
        return existing;
      }

      if (this.swRegistrationPromise) {
        const reg = await this.swRegistrationPromise;
        if (reg?.active) {
          this.cachedRegistration = reg;
          return reg;
        }
      } else {
        const reg = await navigator.serviceWorker.register('/sw.js');
        if (reg?.active) {
          this.cachedRegistration = reg;
          return reg;
        }
      }

      const readyReg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1200)),
      ]);
      if (readyReg?.active) {
        this.cachedRegistration = readyReg;
        return readyReg;
      }
      return null;
    } catch {
      return null;
    }
  }

  async notify(
    title: string,
    body: string,
    isManualTest: boolean = false,
    sessionRunId?: string | null
  ): Promise<boolean> {
    if (!this.hasPermission()) return false;

    const effectiveTag = isManualTest
      ? `pomodor-test-${Date.now()}`
      : sessionRunId
      ? `pomodor-run-${sessionRunId}`
      : `pomodor-alert-${Date.now()}`;

    if (!isManualTest && sessionRunId && this.lastNotifiedTag === effectiveTag) {
      return true;
    }
    this.lastNotifiedTag = effectiveTag;

    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate([200, 100, 200]);
      }
    } catch {
      // Ignore vibration errors
    }

    const options: NotificationOptions = {
      body,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: effectiveTag,
      renotify: true,
    } as NotificationOptions;

    const syncWorker =
      this.cachedRegistration?.active ||
      (typeof navigator !== 'undefined' && 'serviceWorker' in navigator
        ? navigator.serviceWorker.controller
        : null);

    if (syncWorker) {
      try {
        syncWorker.postMessage({
          type: 'SHOW_NOTIFICATION',
          title,
          body,
          tag: effectiveTag,
          isManualTest,
        });
      } catch {
        // Ignore postMessage error
      }
    }

    if (this.cachedRegistration?.active && typeof this.cachedRegistration.showNotification === 'function') {
      try {
        // Close any leftover notification from an earlier session so the new session (e.g. Break after Focus)
        // always triggers a fresh heads-up banner on Android & iOS.
        this.cachedRegistration
          .getNotifications()
          .then((list) => {
            for (const n of list) {
              if (n.tag !== effectiveTag) {
                n.close();
              }
            }
          })
          .catch(() => {});

        await this.cachedRegistration.showNotification(title, options);
        return true;
      } catch {
        // Fall through
      }
    }

    try {
      const reg = await this.getActiveRegistration();
      if (reg && reg.active && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, options);
        return true;
      }
    } catch {
      // Fall through to native Notification constructor
    }

    try {
      new Notification(title, options);
      return true;
    } catch (err) {
      console.warn('Unable to dispatch notification:', err);
      return false;
    }
  }

  /**
   * Schedules a backup notification in the Service Worker at the exact targetEndTime
   * so the phone Home Screen or lock screen receives the alert even if the browser throttles the page.
   */
  scheduleTimerNotification(
    targetEndTimeMs: number,
    sessionType: SessionType,
    enabled: boolean,
    sessionRunId?: string | null
  ): void {
    if (!enabled || !this.hasPermission()) {
      this.cancelScheduledNotification();
      return;
    }

    const title =
      sessionType === 'WORK'
        ? 'Pomodor — Focus session complete'
        : 'Pomodor — Break complete';
    const body =
      sessionType === 'WORK'
        ? 'Your focus timer has finished. Time for a break.'
        : 'Your break timer has finished. Ready for the next focus session?';
    const effectiveTag = sessionRunId
      ? `pomodor-run-${sessionRunId}`
      : `pomodor-type-${sessionType.toLowerCase()}`;

    const syncWorker =
      this.cachedRegistration?.active ||
      (typeof navigator !== 'undefined' && 'serviceWorker' in navigator
        ? navigator.serviceWorker.controller
        : null);

    if (syncWorker) {
      try {
        syncWorker.postMessage({
          type: 'SCHEDULE_TIMER_NOTIFICATION',
          targetEndTime: targetEndTimeMs,
          title,
          body,
          tag: effectiveTag,
        });
        return;
      } catch {
        // Fall through to async lookup
      }
    }

    this.getActiveRegistration().then((reg) => {
      const worker = reg?.active || navigator.serviceWorker?.controller;
      if (worker) {
        worker.postMessage({
          type: 'SCHEDULE_TIMER_NOTIFICATION',
          targetEndTime: targetEndTimeMs,
          title,
          body,
          tag: effectiveTag,
        });
      }
    });
  }

  cancelScheduledNotification(): void {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    const syncWorker =
      this.cachedRegistration?.active ||
      navigator.serviceWorker?.controller;

    if (syncWorker) {
      try {
        syncWorker.postMessage({
          type: 'CANCEL_TIMER_NOTIFICATION',
        });
        return;
      } catch {
        // Fall through
      }
    }

    this.getActiveRegistration().then((reg) => {
      const worker = reg?.active || navigator.serviceWorker?.controller;
      if (worker) {
        worker.postMessage({
          type: 'CANCEL_TIMER_NOTIFICATION',
        });
      }
    });
  }
}

export const notificationService = new NotificationService();

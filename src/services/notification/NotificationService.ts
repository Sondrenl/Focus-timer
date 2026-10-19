import { SessionType } from '../../types/timer';

export type NotificationPermissionStatus = NotificationPermission | 'unsupported';

/**
 * Service to handle browser & mobile lock-screen notifications via Service Worker
 * with graceful fallback and live permission status inspection.
 */
export class NotificationService {
  private swRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

  constructor() {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      this.swRegistrationPromise = navigator.serviceWorker
        .register('/sw.js')
        .catch((err) => {
          console.warn('Service worker registration failed:', err);
          return null;
        });
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
      // Support both Promise-based and legacy callback-based Notification.requestPermission
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
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return null;
    }
    try {
      const existing = await navigator.serviceWorker.getRegistration();
      if (existing?.active) return existing;

      if (this.swRegistrationPromise) {
        const reg = await this.swRegistrationPromise;
        if (reg?.active) return reg;
      } else {
        const reg = await navigator.serviceWorker.register('/sw.js');
        if (reg?.active) return reg;
      }

      // Wait briefly (up to 1200ms) for navigator.serviceWorker.ready if worker is still activating
      const readyReg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1200)),
      ]);
      return readyReg && readyReg.active ? readyReg : null;
    } catch {
      return null;
    }
  }

  async notify(title: string, body: string): Promise<boolean> {
    this.cancelScheduledNotification();

    if (!this.hasPermission()) return false;

    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate([200, 100, 200, 100, 400]);
      }
    } catch {
      // Ignore vibration errors
    }

    const uniqueTag = `pomodor-timer-${Date.now()}`;
    const options: NotificationOptions = {
      body,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: uniqueTag,
    };

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
   * so the phone lock screen or Home Screen still receives the alert even if the browser throttles the page.
   */
  scheduleTimerNotification(targetEndTimeMs: number, sessionType: SessionType, enabled: boolean): void {
    if (!enabled || !this.hasPermission()) {
      this.cancelScheduledNotification();
      return;
    }

    const title = sessionType === 'WORK' ? 'Session Complete!' : 'Break Finished';
    const body =
      sessionType === 'WORK'
        ? 'Great focus! Time to take a well-deserved break.'
        : 'Ready to dive back into deep work?';

    this.getActiveRegistration().then((reg) => {
      const worker = reg?.active || navigator.serviceWorker?.controller;
      if (worker) {
        worker.postMessage({
          type: 'SCHEDULE_TIMER_NOTIFICATION',
          targetEndTime: targetEndTimeMs,
          title,
          body,
        });
      }
    });
  }

  cancelScheduledNotification(): void {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
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

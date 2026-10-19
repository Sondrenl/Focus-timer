import { SessionType } from '../../types/timer';

/**
 * Service to handle browser & mobile lock-screen notifications via Service Worker
 * with graceful fallback and permission handling.
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

  async requestPermission(): Promise<boolean> {
    if (!this.isSupported()) return false;
    try {
      if (Notification.permission === 'granted') {
        return true;
      }
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    } catch {
      return false;
    }
  }

  hasPermission(): boolean {
    if (!this.isSupported()) return false;
    return Notification.permission === 'granted';
  }

  private async getRegistration(): Promise<ServiceWorkerRegistration | null> {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return null;
    }
    try {
      const existing = await navigator.serviceWorker.getRegistration();
      if (existing) return existing;
      if (this.swRegistrationPromise) {
        return await this.swRegistrationPromise;
      }
      return await navigator.serviceWorker.register('/sw.js');
    } catch {
      return null;
    }
  }

  notify(title: string, body: string): void {
    this.cancelScheduledNotification();

    if (!this.hasPermission()) return;

    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate([200, 100, 200, 100, 400]);
      }
    } catch {
      // Ignore vibration errors
    }

    // Prefer ServiceWorkerRegistration.showNotification (required by mobile browsers & lock screens)
    this.getRegistration()
      .then((reg) => {
        if (reg && typeof reg.showNotification === 'function') {
          return reg.showNotification(title, {
            body,
            icon: '/favicon.svg',
            badge: '/favicon.svg',
            tag: 'pomodor-timer-complete',
            renotify: true,
            vibrate: [200, 100, 200, 100, 400],
          } as NotificationOptions);
        }
        // Fallback for desktop environments without an active Service Worker
        new Notification(title, {
          body,
          icon: '/favicon.svg',
          tag: 'pomodor-timer-complete',
        });
      })
      .catch(() => {
        try {
          new Notification(title, {
            body,
            icon: '/favicon.svg',
            tag: 'pomodor-timer-complete',
          });
        } catch (err) {
          console.warn('Unable to dispatch notification:', err);
        }
      });
  }

  /**
   * Schedules a backup notification in the Service Worker at the exact targetEndTime
   * so the phone lock screen still receives the alert even if the browser throttles the page.
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

    this.getRegistration().then((reg) => {
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
    this.getRegistration().then((reg) => {
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

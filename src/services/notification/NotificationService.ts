import { SessionType } from '../../types/timer';
import { isMobileDevice } from '../../utils/environment';
import { AuthService } from '../auth/AuthService';

export type NotificationPermissionStatus = NotificationPermission | 'unsupported';

const ACTIVE_NOTIFICATION_TAG = 'pomodor-active-alert';

/**
 * Service to handle browser & mobile Home Screen / lock-screen notifications via Service Worker
 * with automatic cleanup of prior notifications and live permission status inspection.
 */
export class NotificationService {
  private swRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;
  private cachedRegistration: ServiceWorkerRegistration | null = null;
  private lastNotifiedSessionId: string | null = null;

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

  /**
   * Helper to dispatch messages to the active Service Worker or controller with fallback.
   */
  private sendWorkerMessage(message: unknown): void {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    const syncWorker =
      this.cachedRegistration?.active || navigator.serviceWorker?.controller;

    if (syncWorker) {
      try {
        syncWorker.postMessage(message);
        return;
      } catch {
        // Fall through to active registration resolution
      }
    }

    this.getActiveRegistration().then((reg) => {
      const worker = reg?.active || navigator.serviceWorker?.controller;
      if (worker) {
        try {
          worker.postMessage(message);
        } catch {
          // Ignored
        }
      }
    });
  }

  public setAuthToken(token: string | null): void {
    this.sendWorkerMessage({ type: 'SET_AUTH_TOKEN', token });
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

  /**
   * Closes any previous Pomodor notifications in the notification center so they never bunch up.
   */
  clearActiveNotifications(): void {
    this.sendWorkerMessage({ type: 'CLEAR_NOTIFICATIONS' });

    if (this.cachedRegistration && typeof this.cachedRegistration.getNotifications === 'function') {
      this.cachedRegistration
        .getNotifications()
        .then((list) => {
          for (const n of list) {
            n.close();
          }
        })
        .catch(() => {});
    }
  }

  private markSessionNotifiedInWorker(sessionId?: string | null): void {
    this.sendWorkerMessage({
      type: 'MARK_SESSION_NOTIFIED',
      sessionId: sessionId || null,
    });
  }

  async notify(
    title: string,
    body: string,
    isManualTest: boolean = false,
    sessionRunId?: string | null
  ): Promise<boolean> {
    if (!this.hasPermission()) return false;

    if (!isManualTest && sessionRunId && this.lastNotifiedSessionId === sessionRunId) {
      return true;
    }
    if (sessionRunId) {
      this.lastNotifiedSessionId = sessionRunId;
    }

    // Cancel any pending scheduled timer notification in the Service Worker
    // and notify worker so it never fires a duplicate alert for this session
    this.cancelScheduledNotification();
    this.markSessionNotifiedInWorker(sessionRunId);

    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate([250, 100, 250]);
      }
    } catch {
      // Ignore vibration errors
    }

    const notifTag = isManualTest ? `pomodor-test-${Date.now()}` : ACTIVE_NOTIFICATION_TAG;
    const options: NotificationOptions = {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: notifTag,
      renotify: true,
      silent: false,
      requireInteraction: true,
      vibrate: [250, 100, 250],
    } as NotificationOptions;

    // 1. Direct ServiceWorkerRegistration dispatch (standard for PWA & mobile)
    try {
      const reg = this.cachedRegistration?.active
        ? this.cachedRegistration
        : await this.getActiveRegistration();
      if (reg && reg.active && typeof reg.showNotification === 'function') {
        if (!isManualTest) {
          try {
            const existing = await reg.getNotifications();
            for (const n of existing) {
              n.close();
            }
          } catch {
            // Ignore
          }
        }
        await reg.showNotification(title, options);
        return true;
      }
    } catch (err) {
      console.warn('reg.showNotification failed, trying Window Notification:', err);
    }

    // 2. Window Notification constructor fallback
    try {
      if (typeof Notification === 'function') {
        const notif = new Notification(title, {
          body,
          icon: '/icon-192.png',
          tag: notifTag,
          silent: false,
        });
        notif.onclick = () => {
          try {
            window.focus();
          } catch {
            // Ignore
          }
        };
        return true;
      }
    } catch (err) {
      console.warn('new Notification failed, trying ServiceWorker postMessage:', err);
    }

    // 3. Service Worker message dispatch fallback
    this.sendWorkerMessage({
      type: 'SHOW_NOTIFICATION',
      title,
      body,
      sessionId: sessionRunId || null,
      isManualTest,
      token: AuthService.getInstance().getStoredToken(),
    });
    return true;
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

    // Use identical declarative sentence structure for Focus and Break so Chrome's on-device
    // spam classifier never flags Break notifications.
    const title =
      sessionType === 'WORK'
        ? 'Pomodor — Focus session complete'
        : 'Pomodor — Break session complete';
    const body =
      sessionType === 'WORK'
        ? 'Your focus timer has finished. Time for a break.'
        : 'Your break timer has finished. Time for a focus session.';

    this.sendWorkerMessage({
      type: 'SCHEDULE_TIMER_NOTIFICATION',
      targetEndTime: targetEndTimeMs,
      title,
      body,
      sessionId: sessionRunId || null,
      sessionType,
      isMobile: isMobileDevice(),
      token: AuthService.getInstance().getStoredToken(),
    });
  }

  cancelScheduledNotification(): void {
    this.sendWorkerMessage({
      type: 'CANCEL_TIMER_NOTIFICATION',
    });
  }
}

export const notificationService = new NotificationService();

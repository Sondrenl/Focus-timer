import { SessionType } from '../../types/timer';
import { isMobileDevice } from '../../utils/environment';

export type NotificationPermissionStatus = 'granted' | 'denied' | 'default' | 'unsupported';
export type PushSubscriptionStatus =
  | 'active'
  | 'unsubscribed'
  | 'permission_denied'
  | 'unsupported'
  | 'unconfigured'
  | 'error';

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function arrayBufferToBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return '';
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function uint8ArraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export interface PushRegisterPayload {
  deviceId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
  isMobile?: boolean;
}

export class NotificationService {
  private swRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;
  private cachedRegistration: ServiceWorkerRegistration | null = null;
  private lastNotifiedSessionId: string | null = null;
  private pushSyncInFlight: Promise<{ ok: boolean; status: PushSubscriptionStatus; reason?: string }> | null = null;
  private pushStatus: PushSubscriptionStatus = 'unsubscribed';
  private pushStatusListeners = new Set<(status: PushSubscriptionStatus) => void>();

  constructor() {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      this.swRegistrationPromise = navigator.serviceWorker
        .register('/sw.js', { updateViaCache: 'none' })
        .then((reg) => {
          this.cachedRegistration = reg;
          return reg;
        })
        .catch(() => null);

      navigator.serviceWorker.ready
        .then((reg) => {
          this.cachedRegistration = reg;
        })
        .catch(() => {});

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        navigator.serviceWorker.getRegistration().then((reg) => {
          if (reg) {
            this.cachedRegistration = reg;
          }
        }).catch(() => {});
      });

      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible' && this.cachedRegistration) {
            this.cachedRegistration.update().catch(() => {});
          }
        });
      }
    }
  }

  private setPushStatus(status: PushSubscriptionStatus): void {
    this.pushStatus = status;
    for (const listener of this.pushStatusListeners) {
      try {
        listener(status);
      } catch {
        // Ignore listener errors
      }
    }
  }

  getPushStatus(): PushSubscriptionStatus {
    return this.pushStatus;
  }

  subscribePushStatus(listener: (status: PushSubscriptionStatus) => void): () => void {
    this.pushStatusListeners.add(listener);
    return () => {
      this.pushStatusListeners.delete(listener);
    };
  }

  isSupported(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window;
  }

  isPushSupported(): boolean {
    return (
      this.isSupported() &&
      'serviceWorker' in navigator &&
      'PushManager' in window
    );
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
      let result: NotificationPermission;
      try {
        // Modern standard: Notification.requestPermission returns a Promise
        result = await Notification.requestPermission();
      } catch {
        // Fallback for older browsers (e.g. legacy Safari <= 15)
        result = await new Promise<NotificationPermission>((resolve) => {
          try {
            Notification.requestPermission((p) => resolve(p));
          } catch {
            resolve(Notification.permission);
          }
        });
      }
      return result === 'granted';
    } catch {
      return false;
    }
  }

  hasPermission(): boolean {
    return this.getPermissionState() === 'granted';
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
        // Fallback to async retrieval below
      }
    }

    this.getActiveRegistration().then((reg) => {
      const worker = reg?.active || navigator.serviceWorker?.controller;
      if (worker) {
        try {
          worker.postMessage(message);
        } catch {
          // Ignore
        }
      }
    });
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
        const reg = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
        if (reg?.active) {
          this.cachedRegistration = reg;
          return reg;
        }
      }

      const readyReg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
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

  async getPushSubscriptionState(): Promise<PushSubscription | null> {
    if (!this.isPushSupported()) return null;
    try {
      const reg = await this.getActiveRegistration();
      if (!reg?.pushManager) return null;
      return await reg.pushManager.getSubscription();
    } catch {
      return null;
    }
  }

  async syncPushSubscription({
    vapidPublicKey,
    deviceId,
    registerFn,
  }: {
    vapidPublicKey: string | null | undefined;
    deviceId: string;
    registerFn: (payload: PushRegisterPayload) => Promise<unknown>;
  }): Promise<{ ok: boolean; status: PushSubscriptionStatus; reason?: string }> {
    if (!this.isPushSupported()) {
      this.setPushStatus('unsupported');
      return { ok: false, status: 'unsupported', reason: 'PushManager unsupported' };
    }
    if (!this.hasPermission()) {
      this.setPushStatus('permission_denied');
      return { ok: false, status: 'permission_denied', reason: 'Notification permission not granted' };
    }
    const trimmedKey = vapidPublicKey?.trim();
    if (!trimmedKey) {
      this.setPushStatus('unconfigured');
      return { ok: false, status: 'unconfigured', reason: 'VAPID public key unavailable' };
    }

    if (this.pushSyncInFlight) {
      return this.pushSyncInFlight;
    }

    const run = async (): Promise<{ ok: boolean; status: PushSubscriptionStatus; reason?: string }> => {
      try {
        const reg = await this.getActiveRegistration();
        if (!reg?.pushManager) {
          this.setPushStatus('unsupported');
          return { ok: false, status: 'unsupported', reason: 'Service Worker unavailable' };
        }

        const expectedKeyBytes = urlBase64ToUint8Array(trimmedKey);
        let subscription = await reg.pushManager.getSubscription();

        // If VAPID public key rotated or differs, cleanly replace the stale subscription
        if (subscription?.options?.applicationServerKey) {
          const currentKeyBytes = new Uint8Array(subscription.options.applicationServerKey);
          if (!uint8ArraysEqual(currentKeyBytes, expectedKeyBytes)) {
            try {
              await subscription.unsubscribe();
            } catch {
              // Ignore unsubscribe failure and attempt fresh subscribe
            }
            subscription = null;
          }
        }

        if (!subscription) {
          subscription = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: expectedKeyBytes as BufferSource,
          });
        }

        const subJson = typeof subscription.toJSON === 'function' ? subscription.toJSON() : {};
        const p256dh =
          subJson.keys?.p256dh ||
          (typeof subscription.getKey === 'function'
            ? arrayBufferToBase64Url(subscription.getKey('p256dh'))
            : '');
        const auth =
          subJson.keys?.auth ||
          (typeof subscription.getKey === 'function'
            ? arrayBufferToBase64Url(subscription.getKey('auth'))
            : '');

        if (!subscription.endpoint || !p256dh || !auth) {
          this.setPushStatus('error');
          return { ok: false, status: 'error', reason: 'Incomplete push subscription keys' };
        }

        await registerFn({
          deviceId,
          endpoint: subscription.endpoint,
          p256dh,
          auth,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 256) : undefined,
          isMobile: isMobileDevice(),
        });

        this.setPushStatus('active');
        return { ok: true, status: 'active' };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Push subscription failed';
        console.warn('[Push] Subscription sync failed:', msg);
        this.setPushStatus('error');
        return { ok: false, status: 'error', reason: msg };
      } finally {
        this.pushSyncInFlight = null;
      }
    };

    this.pushSyncInFlight = run();
    return this.pushSyncInFlight;
  }

  async unsubscribePush(unregisterFn?: () => Promise<unknown>): Promise<void> {
    if (unregisterFn) {
      try {
        await unregisterFn();
      } catch {
        // Ignore backend unregister errors
      }
    }
    try {
      const sub = await this.getPushSubscriptionState();
      if (sub) {
        await sub.unsubscribe();
      }
    } catch {
      // Ignore browser unsubscribe errors
    }
    this.setPushStatus('unsubscribed');
  }

  private markSessionNotifiedInWorker(sessionId?: string | null): void {
    if (!sessionId) return;
    this.sendWorkerMessage({
      type: 'MARK_SESSION_NOTIFIED',
      sessionId,
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
    this.cancelScheduledNotification();

    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate([250, 100, 250]);
      }
    } catch {
      // Ignore vibration errors
    }

    const mobile = isMobileDevice();
    const notifTag = isManualTest
      ? `pomodor-test-${Date.now()}`
      : sessionRunId
      ? `pomodor-session-${sessionRunId}`
      : `pomodor-alert-${Date.now()}`;

    const options: NotificationOptions = {
      body,
      icon: '/icon-192.png',
      badge: '/badge-72.png',
      tag: notifTag,
      timestamp: Date.now(),
      renotify: true,
      silent: false,
      vibrate: [250, 100, 250],
      ...(mobile ? {} : { requireInteraction: true }),
    } as NotificationOptions;

    // 1. Direct ServiceWorkerRegistration dispatch (standard for PWA & mobile)
    try {
      const reg = this.cachedRegistration?.active
        ? this.cachedRegistration
        : await this.getActiveRegistration();
      if (reg && reg.active && typeof reg.showNotification === 'function') {
        if (!isManualTest && sessionRunId && typeof reg.getNotifications === 'function') {
          try {
            const existingSameTag = await reg.getNotifications({ tag: notifTag });
            if (existingSameTag.length > 0) {
              this.markSessionNotifiedInWorker(sessionRunId);
              return true;
            }
          } catch {
            // Ignore getNotifications check failure
          }
        }

        // Clean up older Pomodor notifications BEFORE posting the new one so Android's
        // wearable bridge never gets interrupted by a trailing notif.close().
        if (typeof reg.getNotifications === 'function') {
          try {
            const existing = await reg.getNotifications();
            for (const n of existing) {
              if (n.tag !== notifTag) {
                n.close();
              }
            }
          } catch {
            // Ignore cleanup errors
          }
        }

        // Mark notified in SW BEFORE awaiting showNotification to avoid push/page races
        this.markSessionNotifiedInWorker(sessionRunId);
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
            notif.close();
          } catch {
            // Ignore
          }
        };
        this.markSessionNotifiedInWorker(sessionRunId);
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
      isMobile: mobile,
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
    });
  }

  cancelScheduledNotification(): void {
    this.sendWorkerMessage({
      type: 'CANCEL_TIMER_NOTIFICATION',
    });
  }
}

export const notificationService = new NotificationService();

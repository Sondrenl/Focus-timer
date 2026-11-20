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
  origin?: string;
}

export class NotificationService {
  private swRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;
  private cachedRegistration: ServiceWorkerRegistration | null = null;
  private lastNotifiedSessionId: string | null = null;
  private pushSyncInFlight: Promise<{ ok: boolean; status: PushSubscriptionStatus; reason?: string }> | null = null;
  private pushStatus: PushSubscriptionStatus = 'unsubscribed';
  private pushStatusListeners = new Set<(status: PushSubscriptionStatus) => void>();
  private controllerChangeHandler: (() => void) | null = null;
  private visibilityChangeHandler: (() => void) | null = null;

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

      this.controllerChangeHandler = () => {
        navigator.serviceWorker
          .getRegistration()
          .then((reg) => {
            if (reg) {
              this.cachedRegistration = reg;
            }
          })
          .catch(() => {});
      };
      navigator.serviceWorker.addEventListener('controllerchange', this.controllerChangeHandler);

      if (typeof document !== 'undefined') {
        this.visibilityChangeHandler = () => {
          if (document.visibilityState === 'visible' && this.cachedRegistration) {
            this.cachedRegistration.update().catch(() => {});
          }
        };
        document.addEventListener('visibilitychange', this.visibilityChangeHandler);
      }
    }
  }

  destroy(): void {
    if (
      typeof navigator !== 'undefined' &&
      'serviceWorker' in navigator &&
      this.controllerChangeHandler &&
      typeof navigator.serviceWorker.removeEventListener === 'function'
    ) {
      navigator.serviceWorker.removeEventListener('controllerchange', this.controllerChangeHandler);
    }
    this.controllerChangeHandler = null;

    if (typeof document !== 'undefined' && this.visibilityChangeHandler) {
      document.removeEventListener('visibilitychange', this.visibilityChangeHandler);
    }
    this.visibilityChangeHandler = null;
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
    if (!this.isSupported()) return false;
    const hasWindowPushManager = 'pushManager' in window;
    const hasSwPushManager = 'serviceWorker' in navigator && 'PushManager' in window;
    return hasWindowPushManager || hasSwPushManager;
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
      const result = await Notification.requestPermission();
      return result === 'granted';
    } catch {
      return false;
    }
  }

  hasPermission(): boolean {
    return this.getPermissionState() === 'granted';
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

  private async getPushManager(): Promise<PushManager | null> {
    const reg = await this.getActiveRegistration();
    if (reg?.pushManager) return reg.pushManager;
    // Declarative Web Push (Safari 18.4+ / 18.5+) exposes window.pushManager directly
    const windowPushManager = (window as unknown as { pushManager?: PushManager }).pushManager;
    return windowPushManager ?? null;
  }

  async getPushSubscriptionState(): Promise<PushSubscription | null> {
    if (!this.isPushSupported()) return null;
    try {
      const pushManager = await this.getPushManager();
      if (!pushManager) return null;
      return await pushManager.getSubscription();
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
        const pushManager = await this.getPushManager();
        if (!pushManager) {
          this.setPushStatus('unsupported');
          return { ok: false, status: 'unsupported', reason: 'PushManager unavailable' };
        }

        const expectedKeyBytes = urlBase64ToUint8Array(trimmedKey);
        let subscription = await pushManager.getSubscription();

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
          subscription = await pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: expectedKeyBytes as BufferSource,
          });
        }

        const subJson = typeof subscription.toJSON === 'function' ? subscription.toJSON() : {};
        const p256dh = subJson.keys?.p256dh || '';
        const auth = subJson.keys?.auth || '';

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
          origin: typeof window !== 'undefined' ? window.location?.origin : undefined,
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

  /**
   * Local OS notification dispatch for signed-out, offline, or manual test alerts.
   * Uses native OS defaults for sound, vibration, banner persistence, and tag coalescing.
   */
  async notify(
    title: string,
    body: string,
    isManualTest: boolean = false,
    sessionRunId?: string | null,
    notifOpts?: { silent?: boolean }
  ): Promise<boolean> {
    if (!this.hasPermission()) return false;

    const silent = Boolean(notifOpts?.silent);

    if (!isManualTest && sessionRunId && this.lastNotifiedSessionId === sessionRunId) {
      return true;
    }

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
      silent,
    };

    // 1. Standard ServiceWorkerRegistration dispatch (works on desktop, Android, & iOS PWAs)
    try {
      const reg = this.cachedRegistration?.active
        ? this.cachedRegistration
        : await this.getActiveRegistration();
      if (reg?.active && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, options);
        if (sessionRunId) {
          this.lastNotifiedSessionId = sessionRunId;
        }
        return true;
      }
    } catch (err) {
      console.warn('reg.showNotification failed, trying Window Notification:', err);
    }

    // 2. Window Notification constructor fallback (desktop browsers without an active SW)
    try {
      if (typeof Notification === 'function') {
        const notif = new Notification(title, {
          body,
          icon: '/icon-192.png',
          tag: notifTag,
          silent,
        });
        notif.onclick = () => {
          try {
            window.focus();
            notif.close();
          } catch {
            // Ignore
          }
        };
        if (sessionRunId) {
          this.lastNotifiedSessionId = sessionRunId;
        }
        return true;
      }
    } catch (err) {
      console.warn('new Notification failed:', err);
    }

    return false;
  }
}

export const notificationService = new NotificationService();

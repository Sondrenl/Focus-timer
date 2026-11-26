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
  private lastRegisteredEndpoint: string | null = null;
  private syncEpoch = 0;
  private pushStatus: PushSubscriptionStatus = 'unsubscribed';
  private pushStatusListeners = new Set<(status: PushSubscriptionStatus) => void>();
  private pushResyncListeners = new Set<() => void>();
  private controllerChangeHandler: (() => void) | null = null;
  private swMessageHandler: ((event: MessageEvent) => void) | null = null;
  private visibilityChangeHandler: (() => void) | null = null;

  constructor() {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      this.swRegistrationPromise = navigator.serviceWorker
        .register('/sw.js', { updateViaCache: 'none' })
        .then((reg) => {
          this.cachedRegistration = reg;
          return reg;
        })
        .catch(() => {
          this.swRegistrationPromise = null;
          return null;
        });

      navigator.serviceWorker.ready
        .then((reg) => {
          this.cachedRegistration = reg;
        })
        .catch(() => {});

      const notifyResync = () => {
        for (const listener of this.pushResyncListeners) {
          try {
            listener();
          } catch {
            // Ignore listener errors
          }
        }
      };

      this.controllerChangeHandler = () => {
        navigator.serviceWorker
          .getRegistration()
          .then((reg) => {
            if (reg) this.cachedRegistration = reg;
            notifyResync();
          })
          .catch(() => {});
      };
      navigator.serviceWorker.addEventListener('controllerchange', this.controllerChangeHandler);

      this.swMessageHandler = (event: MessageEvent) => {
        if (event.data?.type === 'PUSH_SUBSCRIPTION_CHANGED') {
          notifyResync();
        }
      };
      navigator.serviceWorker.addEventListener('message', this.swMessageHandler);

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
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
    if (sw && typeof sw.removeEventListener === 'function') {
      if (this.controllerChangeHandler) {
        sw.removeEventListener('controllerchange', this.controllerChangeHandler);
      }
      if (this.swMessageHandler) {
        sw.removeEventListener('message', this.swMessageHandler);
      }
    }
    this.controllerChangeHandler = null;
    this.swMessageHandler = null;

    if (typeof document !== 'undefined' && this.visibilityChangeHandler) {
      document.removeEventListener('visibilitychange', this.visibilityChangeHandler);
    }
    this.visibilityChangeHandler = null;
  }

  private setPushStatus(status: PushSubscriptionStatus): void {
    if (this.pushStatus === status) return;
    this.pushStatus = status;
    for (const listener of this.pushStatusListeners) {
      try {
        listener(status);
      } catch {
        // Ignore listener errors
      }
    }
  }

  resetPushStatus(status: PushSubscriptionStatus = 'unsubscribed'): void {
    this.syncEpoch++;
    this.pushSyncInFlight = null;
    if (status !== 'active') {
      this.lastRegisteredEndpoint = null;
    }
    this.setPushStatus(status);
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

  subscribePushResyncRequested(listener: () => void): () => void {
    this.pushResyncListeners.add(listener);
    return () => {
      this.pushResyncListeners.delete(listener);
    };
  }

  isSupported(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window;
  }

  isPushSupported(): boolean {
    if (!this.isSupported()) return false;
    return 'pushManager' in window || ('serviceWorker' in navigator && 'PushManager' in window);
  }

  getPermissionState(): NotificationPermissionStatus {
    return this.isSupported() ? Notification.permission : 'unsupported';
  }

  async requestPermission(): Promise<boolean> {
    if (!this.isSupported()) return false;
    try {
      if (Notification.permission === 'granted') return true;
      return (await Notification.requestPermission()) === 'granted';
    } catch {
      return false;
    }
  }

  hasPermission(): boolean {
    return this.getPermissionState() === 'granted';
  }

  private getWindowPushManager(): PushManager | null {
    if (typeof window === 'undefined') return null;
    return (window as unknown as { pushManager?: PushManager }).pushManager ?? null;
  }

  private async getActiveRegistration(timeoutMs = 2500): Promise<ServiceWorkerRegistration | null> {
    if (this.cachedRegistration?.active) return this.cachedRegistration;
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;

    try {
      const existing = await navigator.serviceWorker.getRegistration();
      if (existing?.active) {
        this.cachedRegistration = existing;
        return existing;
      }

      const regPromise =
        this.swRegistrationPromise ??
        navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => null);
      const reg = await regPromise;
      if (reg?.active) {
        this.cachedRegistration = reg;
        return reg;
      }

      if (timeoutMs <= 0) return null;

      const readyReg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
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
    const windowPushManager = this.getWindowPushManager();
    const reg = await this.getActiveRegistration(windowPushManager ? 1500 : 6000);
    return reg?.pushManager ?? windowPushManager;
  }

  async getPushSubscriptionState(): Promise<PushSubscription | null> {
    if (!this.isPushSupported()) return null;
    try {
      const pushManager = await this.getPushManager();
      return pushManager ? await pushManager.getSubscription() : null;
    } catch {
      return null;
    }
  }

  async hasSubscriptionChanged(): Promise<boolean> {
    if (!this.isPushSupported() || !this.hasPermission()) return false;
    try {
      const sub = await this.getPushSubscriptionState();
      if (!sub?.endpoint) {
        return this.lastRegisteredEndpoint !== null || this.pushStatus === 'active';
      }
      if (typeof sub.expirationTime === 'number' && sub.expirationTime <= Date.now()) {
        return true;
      }
      return this.lastRegisteredEndpoint !== null && sub.endpoint !== this.lastRegisteredEndpoint;
    } catch {
      return false;
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
    const fail = (status: PushSubscriptionStatus, reason: string) => {
      this.setPushStatus(status);
      return { ok: false, status, reason };
    };

    if (!this.isPushSupported()) return fail('unsupported', 'PushManager unsupported');
    if (!this.hasPermission()) return fail('permission_denied', 'Notification permission not granted');
    const trimmedKey = vapidPublicKey?.trim();
    if (!trimmedKey) return fail('unconfigured', 'VAPID public key unavailable');

    if (this.pushSyncInFlight) return this.pushSyncInFlight;

    const epoch = ++this.syncEpoch;
    const isSuperseded = () => epoch !== this.syncEpoch;
    const supersededResult = () => ({
      ok: false,
      status: this.pushStatus,
      reason: 'Superseded by unsubscribe or reset',
    });

    let currentPromise: Promise<{
      ok: boolean;
      status: PushSubscriptionStatus;
      reason?: string;
    }> | null = null;
    currentPromise = (async (): Promise<{
      ok: boolean;
      status: PushSubscriptionStatus;
      reason?: string;
    }> => {
      try {
        const pushManager = await this.getPushManager();
        if (isSuperseded()) return supersededResult();
        if (!pushManager) return fail('error', 'Service worker not ready yet');

        const expectedKeyBytes = urlBase64ToUint8Array(trimmedKey);
        let subscription = await pushManager.getSubscription();

        const isExpired =
          typeof subscription?.expirationTime === 'number' &&
          subscription.expirationTime <= Date.now();
        const isKeyMismatch =
          Boolean(subscription?.options?.applicationServerKey) &&
          !uint8ArraysEqual(
            new Uint8Array(subscription!.options.applicationServerKey!),
            expectedKeyBytes
          );

        if (subscription && (isExpired || isKeyMismatch)) {
          await subscription.unsubscribe().catch(() => {});
          subscription = null;
        }

        if (!subscription) {
          subscription = await pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: expectedKeyBytes as BufferSource,
          });
        }

        if (isSuperseded()) return supersededResult();

        const subJson = typeof subscription.toJSON === 'function' ? subscription.toJSON() : {};
        const p256dh = subJson.keys?.p256dh || '';
        const auth = subJson.keys?.auth || '';

        if (!subscription.endpoint || !p256dh || !auth) {
          return fail('error', 'Incomplete push subscription keys');
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

        if (isSuperseded()) return supersededResult();

        this.lastRegisteredEndpoint = subscription.endpoint;
        this.setPushStatus('active');
        return { ok: true, status: 'active' };
      } catch (err) {
        if (isSuperseded()) return supersededResult();
        const msg = err instanceof Error ? err.message : 'Push subscription failed';
        console.warn('[Push] Subscription sync failed:', msg);
        return fail('error', msg);
      } finally {
        if (this.pushSyncInFlight === currentPromise) {
          this.pushSyncInFlight = null;
        }
      }
    })();

    this.pushSyncInFlight = currentPromise;
    return currentPromise;
  }

  async unsubscribePush(unregisterFn?: () => Promise<unknown>): Promise<void> {
    this.resetPushStatus('unsubscribed');

    if (unregisterFn) {
      await unregisterFn().catch(() => {});
    }

    const managers: PushManager[] = [];
    const reg = await this.getActiveRegistration(2000).catch(() => null);
    if (reg?.pushManager) managers.push(reg.pushManager);

    const winPm = this.getWindowPushManager();
    if (winPm && !managers.includes(winPm)) managers.push(winPm);

    for (const pm of managers) {
      try {
        const sub = await pm.getSubscription();
        if (sub) await sub.unsubscribe();
      } catch {
        // Ignore browser unsubscribe errors
      }
    }
  }

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

    try {
      const reg = this.cachedRegistration?.active
        ? this.cachedRegistration
        : await this.getActiveRegistration();
      if (reg?.active && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, options);
        if (sessionRunId) this.lastNotifiedSessionId = sessionRunId;
        return true;
      }
    } catch (err) {
      console.warn('reg.showNotification failed, trying Window Notification:', err);
    }

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
        if (sessionRunId) this.lastNotifiedSessionId = sessionRunId;
        return true;
      }
    } catch (err) {
      console.warn('new Notification failed:', err);
    }

    return false;
  }
}

export const notificationService = new NotificationService();

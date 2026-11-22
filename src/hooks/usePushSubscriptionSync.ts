import { useState, useEffect, useCallback, useRef, MutableRefObject } from 'react';
import {
  NotificationService,
  PushRegisterPayload,
  PushSubscriptionStatus,
} from '../services/notification/NotificationService';
import { UserSettings } from '../types/settings';
import { DEVICE_ID } from '../context/timer/timerPersistence';
import { settingsRepository } from '../context/services';

const PUSH_RESYNC_TTL_MS = 15 * 60 * 1000;
const SERVER_PRUNE_RECOVERY_COOLDOWN_MS = 30 * 1000;

interface UsePushSubscriptionSyncParams {
  notificationService: NotificationService;
  isConvexConfigured: boolean;
  isEffectiveAuthenticated: boolean;
  isConvexAuthReady?: boolean;
  isConvexConnected?: boolean;
  currentUserId?: string | null;
  isLoggingOutRef?: MutableRefObject<boolean>;
  notificationsEnabled: boolean;
  settingsRef: MutableRefObject<UserSettings>;
  vapidPublicKey?: string | null;
  isServerSubscriptionRegistered?: boolean;
  registerPushSubscription: (args: PushRegisterPayload) => Promise<unknown>;
  unregisterPushSubscription?: (args: { deviceId: string }) => Promise<unknown>;
}

export function usePushSubscriptionSync({
  notificationService,
  isConvexConfigured,
  isEffectiveAuthenticated,
  isConvexAuthReady = isEffectiveAuthenticated,
  isConvexConnected = true,
  currentUserId = null,
  isLoggingOutRef,
  notificationsEnabled,
  settingsRef,
  vapidPublicKey,
  isServerSubscriptionRegistered,
  registerPushSubscription,
  unregisterPushSubscription,
}: UsePushSubscriptionSyncParams) {
  const [pushStatus, setPushStatus] = useState<PushSubscriptionStatus>(() =>
    notificationService.getPushStatus()
  );
  const lastSyncedAtRef = useRef<number>(0);
  const lastPruneRecoveryAtRef = useRef<number>(0);
  const prevConnectedRef = useRef<boolean>(isConvexConnected);
  const isServerRegisteredRef = useRef<boolean | undefined>(isServerSubscriptionRegistered);
  isServerRegisteredRef.current = isServerSubscriptionRegistered;

  const isAuthOperational = isConvexConfigured && isEffectiveAuthenticated && isConvexAuthReady;

  const isNotificationsEnabledLive = useCallback((): boolean => {
    if (!settingsRef.current.notificationsEnabled) return false;
    try {
      return Boolean(settingsRepository.getSync().notificationsEnabled);
    } catch {
      return Boolean(settingsRef.current.notificationsEnabled);
    }
  }, [settingsRef]);

  // Track push status updates emitted by NotificationService
  useEffect(() => {
    setPushStatus(notificationService.getPushStatus());
    return notificationService.subscribePushStatus((status) => {
      if (status !== 'active') {
        lastSyncedAtRef.current = 0;
      }
      setPushStatus(status);
    });
  }, [notificationService]);

  const performSync = useCallback(async () => {
    if (isLoggingOutRef?.current || !isNotificationsEnabledLive()) {
      return { ok: false, status: 'unsubscribed' as PushSubscriptionStatus, reason: 'Notifications disabled or logging out' };
    }
    const result = await notificationService.syncPushSubscription({
      vapidPublicKey,
      deviceId: DEVICE_ID,
      registerFn: registerPushSubscription,
    });
    if (result.ok) {
      lastSyncedAtRef.current = Date.now();
    }
    return result;
  }, [
    notificationService,
    vapidPublicKey,
    registerPushSubscription,
    isLoggingOutRef,
    isNotificationsEnabledLive,
  ]);

  const syncPushSubscription = useCallback(async () => {
    if (!isAuthOperational || isLoggingOutRef?.current) {
      notificationService.resetPushStatus('unsubscribed');
      return { ok: false, status: 'unsubscribed' as PushSubscriptionStatus, reason: 'Unauthenticated' };
    }
    if (!isNotificationsEnabledLive()) {
      notificationService.resetPushStatus('unsubscribed');
      return {
        ok: false,
        status: 'unsubscribed' as PushSubscriptionStatus,
        reason: 'Notifications disabled',
      };
    }
    return performSync();
  }, [
    notificationService,
    isAuthOperational,
    isLoggingOutRef,
    isNotificationsEnabledLive,
    performSync,
  ]);

  // Automatically register/refresh Web Push subscription when authenticated + auth-ready + notifications enabled,
  // and cleanly reset cached pushStatus whenever auth, user, settings, VAPID config, or permission change.
  useEffect(() => {
    if (!isAuthOperational || !notificationsEnabled || isLoggingOutRef?.current) {
      lastSyncedAtRef.current = 0;
      notificationService.resetPushStatus('unsubscribed');
      return;
    }
    if (vapidPublicKey === null) {
      lastSyncedAtRef.current = 0;
      notificationService.resetPushStatus('unconfigured');
      return;
    }
    if (!vapidPublicKey) return;
    if (!notificationService.hasPermission()) {
      lastSyncedAtRef.current = 0;
      const perm = notificationService.getPermissionState();
      notificationService.resetPushStatus(
        perm === 'unsupported'
          ? 'unsupported'
          : perm === 'denied'
            ? 'permission_denied'
            : 'unsubscribed'
      );
      if (perm === 'denied' && isServerRegisteredRef.current === true && unregisterPushSubscription) {
        void unregisterPushSubscription({ deviceId: DEVICE_ID }).catch(() => {});
      }
      return;
    }

    void performSync();
  }, [
    notificationService,
    isAuthOperational,
    currentUserId,
    notificationsEnabled,
    vapidPublicKey,
    isLoggingOutRef,
    unregisterPushSubscription,
    performSync,
  ]);

  // Retry push sync when Convex WebSocket reconnects after a drop if push is not active
  useEffect(() => {
    const wasConnected = prevConnectedRef.current;
    prevConnectedRef.current = isConvexConnected;
    if (
      !wasConnected &&
      isConvexConnected &&
      isAuthOperational &&
      !isLoggingOutRef?.current &&
      isNotificationsEnabledLive() &&
      vapidPublicKey &&
      notificationService.hasPermission() &&
      (notificationService.getPushStatus() !== 'active' || isServerRegisteredRef.current === false)
    ) {
      lastSyncedAtRef.current = 0;
      void performSync();
    }
  }, [
    isConvexConnected,
    isAuthOperational,
    isLoggingOutRef,
    isNotificationsEnabledLive,
    vapidPublicKey,
    notificationService,
    performSync,
  ]);

  // Self-heal if the server pruned this device's push subscription (404/410/403/quota eviction),
  // strictly verifying live per-device localStorage setting and logout guard so another tab turning
  // notifications off or signing out never gets resurrected.
  useEffect(() => {
    if (isServerSubscriptionRegistered !== false) return;
    if (
      !isAuthOperational ||
      isLoggingOutRef?.current ||
      !notificationsEnabled ||
      !isNotificationsEnabledLive() ||
      !vapidPublicKey ||
      !notificationService.hasPermission()
    ) {
      return;
    }

    const now = Date.now();
    if (now - lastPruneRecoveryAtRef.current < SERVER_PRUNE_RECOVERY_COOLDOWN_MS) {
      return;
    }
    lastPruneRecoveryAtRef.current = now;
    lastSyncedAtRef.current = 0;
    void performSync();
  }, [
    isServerSubscriptionRegistered,
    isAuthOperational,
    isLoggingOutRef,
    notificationsEnabled,
    isNotificationsEnabledLive,
    vapidPublicKey,
    notificationService,
    performSync,
  ]);

  // Immediately re-sync if the Service Worker reports a pushsubscriptionchange key rotation or controllerchange
  useEffect(() => {
    return notificationService.subscribePushResyncRequested(() => {
      if (
        !isAuthOperational ||
        isLoggingOutRef?.current ||
        !isNotificationsEnabledLive() ||
        !vapidPublicKey ||
        !notificationService.hasPermission()
      ) {
        return;
      }
      lastSyncedAtRef.current = 0;
      void performSync();
    });
  }, [
    notificationService,
    isAuthOperational,
    isLoggingOutRef,
    isNotificationsEnabledLive,
    vapidPublicKey,
    performSync,
  ]);

  // Listen to browser Permissions API onchange (catches URL-bar grant/revoke without focus/visibility change)
  useEffect(() => {
    if (
      typeof navigator === 'undefined' ||
      !navigator.permissions ||
      typeof navigator.permissions.query !== 'function'
    ) {
      return;
    }
    let cancelled = false;
    let statusObj: PermissionStatus | null = null;
    const handlePermChange = () => {
      if (cancelled || !isAuthOperational || isLoggingOutRef?.current) return;
      if (notificationService.hasPermission()) {
        if (isNotificationsEnabledLive() && vapidPublicKey) {
          lastSyncedAtRef.current = 0;
          void performSync();
        }
      } else {
        const perm = notificationService.getPermissionState();
        notificationService.resetPushStatus(
          perm === 'denied' ? 'permission_denied' : 'unsubscribed'
        );
        if (perm === 'denied' && unregisterPushSubscription) {
          void unregisterPushSubscription({ deviceId: DEVICE_ID }).catch(() => {});
        }
      }
    };
    navigator.permissions
      .query({ name: 'notifications' as PermissionName })
      .then((permStatus) => {
        if (cancelled) return;
        statusObj = permStatus;
        permStatus.addEventListener?.('change', handlePermChange);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      statusObj?.removeEventListener?.('change', handlePermChange);
    };
  }, [
    isAuthOperational,
    isLoggingOutRef,
    isNotificationsEnabledLive,
    vapidPublicKey,
    notificationService,
    unregisterPushSubscription,
    performSync,
  ]);

  // Re-sync push subscription on focus/visibility return (e.g. after granting OS permission or endpoint rotation) or network recovery
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleReturn = async () => {
      if (document.visibilityState === 'hidden') return;
      if (
        !isAuthOperational ||
        isLoggingOutRef?.current ||
        !isNotificationsEnabledLive() ||
        !vapidPublicKey
      ) {
        return;
      }
      if (!notificationService.hasPermission()) {
        const perm = notificationService.getPermissionState();
        notificationService.resetPushStatus(
          perm === 'unsupported'
            ? 'unsupported'
            : perm === 'denied'
              ? 'permission_denied'
              : 'unsubscribed'
        );
        if (perm === 'denied' && isServerRegisteredRef.current === true && unregisterPushSubscription) {
          void unregisterPushSubscription({ deviceId: DEVICE_ID }).catch(() => {});
        }
        return;
      }
      const serverMissing = isServerRegisteredRef.current === false;
      const endpointChanged = await notificationService.hasSubscriptionChanged();
      if (
        !serverMissing &&
        !endpointChanged &&
        notificationService.getPushStatus() === 'active' &&
        Date.now() - lastSyncedAtRef.current < PUSH_RESYNC_TTL_MS
      ) {
        return;
      }
      void performSync();
    };
    const onEvent = () => {
      void handleReturn();
    };
    window.addEventListener('focus', onEvent);
    window.addEventListener('online', onEvent);
    document.addEventListener('visibilitychange', onEvent);
    return () => {
      window.removeEventListener('focus', onEvent);
      window.removeEventListener('online', onEvent);
      document.removeEventListener('visibilitychange', onEvent);
    };
  }, [
    notificationService,
    isAuthOperational,
    isLoggingOutRef,
    isNotificationsEnabledLive,
    vapidPublicKey,
    unregisterPushSubscription,
    performSync,
  ]);

  return {
    pushStatus,
    syncPushSubscription,
  };
}

import { useState, useEffect, useCallback, useRef, MutableRefObject } from 'react';
import {
  NotificationService,
  PushRegisterPayload,
  PushSubscriptionStatus,
} from '../services/notification/NotificationService';
import { UserSettings } from '../types/settings';
import { DEVICE_ID } from '../context/timer/timerPersistence';

const PUSH_RESYNC_TTL_MS = 15 * 60 * 1000;
const SERVER_PRUNE_RECOVERY_COOLDOWN_MS = 30 * 1000;

interface UsePushSubscriptionSyncParams {
  notificationService: NotificationService;
  isConvexConfigured: boolean;
  isEffectiveAuthenticated: boolean;
  notificationsEnabled: boolean;
  settingsRef: MutableRefObject<UserSettings>;
  vapidPublicKey?: string | null;
  isServerSubscriptionRegistered?: boolean;
  registerPushSubscription: (args: PushRegisterPayload) => Promise<unknown>;
}

export function usePushSubscriptionSync({
  notificationService,
  isConvexConfigured,
  isEffectiveAuthenticated,
  notificationsEnabled,
  settingsRef,
  vapidPublicKey,
  isServerSubscriptionRegistered,
  registerPushSubscription,
}: UsePushSubscriptionSyncParams) {
  const [pushStatus, setPushStatus] = useState<PushSubscriptionStatus>(() =>
    notificationService.getPushStatus()
  );
  const lastSyncedAtRef = useRef<number>(0);
  const lastPruneRecoveryAtRef = useRef<number>(0);
  const isServerRegisteredRef = useRef<boolean | undefined>(isServerSubscriptionRegistered);
  isServerRegisteredRef.current = isServerSubscriptionRegistered;

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
    const result = await notificationService.syncPushSubscription({
      vapidPublicKey,
      deviceId: DEVICE_ID,
      registerFn: registerPushSubscription,
    });
    if (result.ok) {
      lastSyncedAtRef.current = Date.now();
    }
    return result;
  }, [notificationService, vapidPublicKey, registerPushSubscription]);

  const syncPushSubscription = useCallback(async () => {
    if (!isConvexConfigured || !isEffectiveAuthenticated) {
      notificationService.resetPushStatus('unsubscribed');
      return { ok: false, status: 'unsubscribed' as PushSubscriptionStatus, reason: 'Unauthenticated' };
    }
    if (!settingsRef.current.notificationsEnabled) {
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
    isConvexConfigured,
    isEffectiveAuthenticated,
    settingsRef,
    performSync,
  ]);

  // Automatically register/refresh Web Push subscription when authenticated and notifications are enabled,
  // and cleanly reset cached pushStatus whenever auth, settings, VAPID config, or permission change.
  useEffect(() => {
    if (!isConvexConfigured || !isEffectiveAuthenticated || !notificationsEnabled) {
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
      return;
    }

    void performSync();
  }, [
    notificationService,
    isConvexConfigured,
    isEffectiveAuthenticated,
    notificationsEnabled,
    vapidPublicKey,
    performSync,
  ]);

  // Self-heal if the server pruned this device's push subscription (404/410/403/quota eviction)
  useEffect(() => {
    if (isServerSubscriptionRegistered !== false) return;
    if (
      !isConvexConfigured ||
      !isEffectiveAuthenticated ||
      !notificationsEnabled ||
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
    isConvexConfigured,
    isEffectiveAuthenticated,
    notificationsEnabled,
    vapidPublicKey,
    notificationService,
    performSync,
  ]);

  // Immediately re-sync if the Service Worker reports a pushsubscriptionchange key rotation
  useEffect(() => {
    return notificationService.subscribePushResyncRequested(() => {
      if (
        !isConvexConfigured ||
        !isEffectiveAuthenticated ||
        !settingsRef.current.notificationsEnabled ||
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
    isConvexConfigured,
    isEffectiveAuthenticated,
    settingsRef,
    vapidPublicKey,
    performSync,
  ]);

  // Re-sync push subscription on focus/visibility return (e.g. after granting OS permission) or network recovery
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleReturn = () => {
      if (document.visibilityState === 'hidden') return;
      if (
        !isConvexConfigured ||
        !isEffectiveAuthenticated ||
        !settingsRef.current.notificationsEnabled ||
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
        return;
      }
      const serverMissing = isServerRegisteredRef.current === false;
      if (
        !serverMissing &&
        notificationService.getPushStatus() === 'active' &&
        Date.now() - lastSyncedAtRef.current < PUSH_RESYNC_TTL_MS
      ) {
        return;
      }
      void performSync();
    };
    window.addEventListener('focus', handleReturn);
    window.addEventListener('online', handleReturn);
    document.addEventListener('visibilitychange', handleReturn);
    return () => {
      window.removeEventListener('focus', handleReturn);
      window.removeEventListener('online', handleReturn);
      document.removeEventListener('visibilitychange', handleReturn);
    };
  }, [
    notificationService,
    isConvexConfigured,
    isEffectiveAuthenticated,
    settingsRef,
    vapidPublicKey,
    performSync,
  ]);

  return {
    pushStatus,
    syncPushSubscription,
  };
}

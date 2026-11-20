import { useState, useEffect, useCallback, useRef, MutableRefObject } from 'react';
import {
  NotificationService,
  PushRegisterPayload,
  PushSubscriptionStatus,
} from '../services/notification/NotificationService';
import { UserSettings } from '../types/settings';
import { DEVICE_ID } from '../context/timer/timerPersistence';

const PUSH_RESYNC_TTL_MS = 15 * 60 * 1000;

interface UsePushSubscriptionSyncParams {
  notificationService: NotificationService;
  isConvexConfigured: boolean;
  isEffectiveAuthenticated: boolean;
  notificationsEnabled: boolean;
  settingsRef: MutableRefObject<UserSettings>;
  vapidPublicKey?: string | null;
  registerPushSubscription: (args: PushRegisterPayload) => Promise<unknown>;
}

export function usePushSubscriptionSync({
  notificationService,
  isConvexConfigured,
  isEffectiveAuthenticated,
  notificationsEnabled,
  settingsRef,
  vapidPublicKey,
  registerPushSubscription,
}: UsePushSubscriptionSyncParams) {
  const [pushStatus, setPushStatus] = useState<PushSubscriptionStatus>(() =>
    notificationService.getPushStatus()
  );
  const lastSyncedAtRef = useRef<number>(0);

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
      return { ok: false, status: notificationService.getPushStatus(), reason: 'Unauthenticated' };
    }
    if (!settingsRef.current.notificationsEnabled) {
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

  // Automatically register/refresh Web Push subscription when authenticated and notifications are enabled
  useEffect(() => {
    if (!isConvexConfigured || !isEffectiveAuthenticated || !notificationsEnabled) {
      lastSyncedAtRef.current = 0;
      return;
    }
    if (!vapidPublicKey) return;
    if (!notificationService.hasPermission()) return;

    void performSync();
  }, [
    notificationService,
    isConvexConfigured,
    isEffectiveAuthenticated,
    notificationsEnabled,
    vapidPublicKey,
    performSync,
  ]);

  // Re-sync push subscription if user returns from OS Settings after granting notification permission
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleReturn = () => {
      if (document.visibilityState === 'hidden') return;
      if (
        !isConvexConfigured ||
        !isEffectiveAuthenticated ||
        !settingsRef.current.notificationsEnabled ||
        !vapidPublicKey ||
        !notificationService.hasPermission()
      ) {
        return;
      }
      if (
        notificationService.getPushStatus() === 'active' &&
        Date.now() - lastSyncedAtRef.current < PUSH_RESYNC_TTL_MS
      ) {
        return;
      }
      void performSync();
    };
    window.addEventListener('focus', handleReturn);
    document.addEventListener('visibilitychange', handleReturn);
    return () => {
      window.removeEventListener('focus', handleReturn);
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

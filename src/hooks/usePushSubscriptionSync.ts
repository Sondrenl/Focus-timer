import { useState, useEffect, useCallback, MutableRefObject } from 'react';
import {
  NotificationService,
  PushRegisterPayload,
  PushSubscriptionStatus,
} from '../services/notification/NotificationService';
import { UserSettings } from '../types/settings';
import { DEVICE_ID } from '../context/timer/timerPersistence';

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

  // Track push status updates emitted by NotificationService
  useEffect(() => {
    setPushStatus(notificationService.getPushStatus());
    return notificationService.subscribePushStatus(setPushStatus);
  }, [notificationService]);

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
    return notificationService.syncPushSubscription({
      vapidPublicKey,
      deviceId: DEVICE_ID,
      registerFn: registerPushSubscription,
    });
  }, [
    notificationService,
    isConvexConfigured,
    isEffectiveAuthenticated,
    settingsRef,
    vapidPublicKey,
    registerPushSubscription,
  ]);

  // Automatically register/refresh Web Push subscription when authenticated and notifications are enabled
  useEffect(() => {
    if (!isConvexConfigured || !isEffectiveAuthenticated) return;
    if (!notificationsEnabled || !vapidPublicKey) return;
    if (!notificationService.hasPermission()) return;

    void notificationService.syncPushSubscription({
      vapidPublicKey,
      deviceId: DEVICE_ID,
      registerFn: registerPushSubscription,
    });
  }, [
    notificationService,
    isConvexConfigured,
    isEffectiveAuthenticated,
    notificationsEnabled,
    vapidPublicKey,
    registerPushSubscription,
  ]);

  // Re-sync push subscription if user returns from OS Settings after granting notification permission
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleReturn = () => {
      if (document.visibilityState === 'hidden') return;
      if (
        isConvexConfigured &&
        isEffectiveAuthenticated &&
        settingsRef.current.notificationsEnabled &&
        vapidPublicKey &&
        notificationService.hasPermission()
      ) {
        void notificationService.syncPushSubscription({
          vapidPublicKey,
          deviceId: DEVICE_ID,
          registerFn: registerPushSubscription,
        });
      }
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
    registerPushSubscription,
  ]);

  return {
    pushStatus,
    syncPushSubscription,
  };
}
